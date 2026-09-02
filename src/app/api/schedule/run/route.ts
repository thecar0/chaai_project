import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import { getSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import {
  CapacityRuleError,
  calculateApartmentEffectiveUnits,
  calculateInspectionArea,
  getDailyLimit,
  type InspectionCategory,
} from "@/lib/capacity";
import { geocodeAddress, KakaoApiError, type Coordinates } from "@/lib/geo/kakao";
import {
  placeInspections,
  type PlacementBuilding,
  type PlacementDayItem,
} from "@/lib/schedule-placement";

const runSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식이어야 합니다"),
  personnelCount: z.number().int().min(3, "기술인력은 최소 3명부터 계산됩니다"),
  apply: z.boolean().optional(),
});

const CATEGORIES: InspectionCategory[] = ["comprehensive", "operational", "apartment"];
const CATEGORY_LABEL: Record<InspectionCategory, string> = {
  comprehensive: "종합점검",
  operational: "작동점검",
  apartment: "아파트",
};

// 종합점검 8,000㎡ / 작동점검 10,000㎡ / 아파트 250세대는 "같은 하루치 능력을 서로
// 다른 기준으로 표현한 것"이다. 그래서 한 카테고리씩 따로 배치하지 않고, 이 함수는
// 그 카테고리의 대상들을 "usageRatio(= 실제 점검면적(세대수) ÷ 그 유형의 하루 한도)"로
// 환산만 해서 돌려준다 - 실제 배치(하루 능력을 넘지 않게 채우기)는 세 카테고리를
// 전부 합친 뒤 한 번에 한다 (POST 핸들러 참고).
async function collectCategoryBuildings(
  session: SessionPayload,
  category: InspectionCategory,
  monthStart: string,
  monthEnd: string,
  dailyLimit: number
): Promise<{ placementBuildings: PlacementBuilding[]; warnings: string[]; found: boolean }> {
  const isGeneralBuilding = or(eq(buildings.isApartment, false), isNull(buildings.isApartment));
  // 사용자가 날짜를 직접 지정(이월)한 건은 자동 배치 대상에서 제외한다.
  const notManuallyScheduled = eq(inspectionSchedules.isManuallyScheduled, false);
  const where =
    category === "apartment"
      ? and(
          eq(buildings.userId, session.userId),
          gte(inspectionSchedules.scheduledDate, monthStart),
          lte(inspectionSchedules.scheduledDate, monthEnd),
          eq(buildings.isApartment, true),
          notManuallyScheduled
        )
      : and(
          eq(buildings.userId, session.userId),
          gte(inspectionSchedules.scheduledDate, monthStart),
          lte(inspectionSchedules.scheduledDate, monthEnd),
          isGeneralBuilding,
          eq(inspectionSchedules.inspectionType, category),
          notManuallyScheduled
        );

  const rows = await db
    .select({
      inspectionId: inspectionSchedules.id,
      inspectionType: inspectionSchedules.inspectionType,
      buildingId: buildings.id,
      name: buildings.name,
      address: buildings.address,
      totalFloorAreaM2: buildings.totalFloorAreaM2,
      hasSprinkler: buildings.hasSprinkler,
      hasWaterSpray: buildings.hasWaterSpray,
      hasSmokeControl: buildings.hasSmokeControl,
      isMultiUseBusiness: buildings.isMultiUseBusiness,
      unitCount: buildings.unitCount,
      latitude: buildings.latitude,
      longitude: buildings.longitude,
    })
    .from(inspectionSchedules)
    .innerJoin(buildings, eq(inspectionSchedules.buildingId, buildings.id))
    .where(where);

  const placementBuildings: PlacementBuilding[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    let rawAmount: number;
    if (category === "apartment") {
      if (!row.unitCount) {
        warnings.push(`${row.name}: 세대수 정보가 없어 배치에서 제외했습니다.`);
        continue;
      }
      rawAmount = calculateApartmentEffectiveUnits({
        unitCount: row.unitCount,
        hasSprinkler: row.hasSprinkler,
        hasWaterSpray: row.hasWaterSpray,
        hasSmokeControl: row.hasSmokeControl,
      });
    } else {
      if (!row.totalFloorAreaM2) {
        warnings.push(`${row.name}: 연면적 정보가 없어 배치에서 제외했습니다.`);
        continue;
      }
      rawAmount = calculateInspectionArea({
        totalAreaM2: row.totalFloorAreaM2,
        hasSprinkler: row.hasSprinkler,
        hasWaterSpray: row.hasWaterSpray,
        hasSmokeControl: row.hasSmokeControl,
        isOperational: row.inspectionType === "operational",
        isMultiUseBusiness: row.isMultiUseBusiness,
      });
    }

    let coordinates: Coordinates | null = null;
    if (row.latitude != null && row.longitude != null) {
      coordinates = { lat: row.latitude, lng: row.longitude };
    } else if (!row.address) {
      warnings.push(`${row.name}: 주소가 없어 거리 계산 없이 배치됩니다. 주소 채우기에서 채워주세요.`);
    } else {
      coordinates = await geocodeAddress(row.address);
      if (coordinates) {
        await db
          .update(buildings)
          .set({ latitude: coordinates.lat, longitude: coordinates.lng })
          .where(eq(buildings.id, row.buildingId));
      } else {
        warnings.push(`${row.name}: 주소로 좌표를 찾지 못해 거리 계산 없이 배치됩니다.`);
      }
    }

    placementBuildings.push({
      buildingId: row.buildingId,
      inspectionId: row.inspectionId,
      name: row.name,
      inspectionType: row.inspectionType,
      category,
      rawAmount,
      usageRatio: rawAmount / dailyLimit,
      coordinates,
    });
  }

  return { placementBuildings, warnings, found: rows.length > 0 };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { month, personnelCount, apply } = parsed.data;

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, "0")}`;

  const dailyLimits = {} as Record<InspectionCategory, number>;
  const allPlacementBuildings: PlacementBuilding[] = [];
  const allWarnings: string[] = [];
  let anyFound = false;

  try {
    for (const category of CATEGORIES) {
      const dailyLimit = getDailyLimit(personnelCount, category);
      dailyLimits[category] = dailyLimit;
      const { placementBuildings, warnings, found } = await collectCategoryBuildings(
        session,
        category,
        monthStart,
        monthEnd,
        dailyLimit
      );
      allPlacementBuildings.push(...placementBuildings);
      allWarnings.push(...warnings);
      if (found) anyFound = true;
    }
  } catch (err) {
    if (err instanceof CapacityRuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof KakaoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  if (!anyFound) {
    return NextResponse.json({ error: "해당 월에 예정된 점검이 없습니다." }, { status: 404 });
  }

  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0); // 선택한 달의 마지막 날

  let placement;
  try {
    placement = await placeInspections(allPlacementBuildings, startDate, endDate);
  } catch (err) {
    if (err instanceof CapacityRuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof KakaoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  // 실제 배치는 유형과 무관하게 하루 능력(비율 1) 기준으로 이미 끝났다. 아래는
  // 화면에 보여주기 위해 날짜별로 다시 카테고리별 그룹을 나누는 것 뿐이다.
  type MergedGroup = {
    category: InspectionCategory;
    label: string;
    dailyLimit: number;
    items: PlacementDayItem[];
  };
  const days = placement.days.map((day) => {
    const groupsMap = new Map<InspectionCategory, MergedGroup>();
    for (const item of day.items) {
      const g = groupsMap.get(item.category) ?? {
        category: item.category,
        label: CATEGORY_LABEL[item.category],
        dailyLimit: dailyLimits[item.category],
        items: [],
      };
      g.items.push(item);
      groupsMap.set(item.category, g);
    }
    return {
      date: day.date,
      usedRatio: day.usedRatio,
      groups: Array.from(groupsMap.values()),
    };
  });

  const unplaced = placement.unplaced.map((u) => ({
    buildingId: u.buildingId,
    inspectionId: u.inspectionId,
    name: u.name,
    reason: u.reason,
    category: CATEGORY_LABEL[u.category],
  }));

  if (apply) {
    for (const day of days) {
      for (const group of day.groups) {
        for (const item of group.items) {
          await db
            .update(inspectionSchedules)
            .set({ scheduledDate: day.date })
            .where(eq(inspectionSchedules.id, item.inspectionId));
        }
      }
    }
  }

  return NextResponse.json({
    days,
    unplaced,
    warnings: allWarnings,
    applied: Boolean(apply),
  });
}
