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
import { preloadDrivingRoutes, makeMemoizedDistanceFn } from "@/lib/geo/distance-cache";
import {
  placeInspections,
  type PlacementBuilding,
  type PlacementDayItem,
  type PlacementResult,
} from "@/lib/schedule-placement";

const runSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식이어야 합니다"),
  personnelCount: z.number().int().min(3, "기술인력은 최소 3명부터 계산됩니다"),
  // 팀별로 나눠서 배치할 때 쓴다 - 없으면(전체) 팀 구분 없이 지금까지처럼 동작한다.
  teamId: z.number().int().positive().optional(),
});

const CATEGORIES: InspectionCategory[] = ["comprehensive", "operational", "apartment"];
const CATEGORY_LABEL: Record<InspectionCategory, string> = {
  comprehensive: "종합점검",
  operational: "작동점검",
  apartment: "아파트",
};

// usageRatio(그 유형의 하루 한도 대비 사용 비율)는 인원수(dailyLimit)에 따라
// 달라지므로, DB 조회·지오코딩처럼 인원수와 무관하게 한 번만 하면 되는 작업과
// 분리했다 - 추천 인원수를 찾을 때 인원수를 바꿔가며 배치를 여러 번 돌려야
// 하는데, 그때마다 DB/지오코딩을 다시 하면 느려진다(RawCategoryBuilding을 한 번만
// 모아두고 toPlacementBuildings로 인원수별 usageRatio만 다시 계산한다).
type RawCategoryBuilding = {
  inspectionId: number;
  buildingId: number;
  name: string;
  inspectionType: "comprehensive" | "operational";
  category: InspectionCategory;
  rawAmount: number;
  coordinates: Coordinates | null;
};

async function collectCategoryRawBuildings(
  session: SessionPayload,
  category: InspectionCategory,
  monthStart: string,
  monthEnd: string,
  teamId: number | undefined
): Promise<{ rawBuildings: RawCategoryBuilding[]; warnings: string[]; found: boolean }> {
  const isGeneralBuilding = or(eq(buildings.isApartment, false), isNull(buildings.isApartment));
  // 사용자가 날짜를 직접 지정(이월)한 건은 자동 배치 대상에서 제외한다.
  const notManuallyScheduled = eq(inspectionSchedules.isManuallyScheduled, false);
  // teamId가 없으면(전체 보기) 팀 조건을 아예 안 걸어서 지금까지처럼 전체 건물을 대상으로 한다.
  const teamCondition = teamId != null ? eq(buildings.teamId, teamId) : undefined;
  const where =
    category === "apartment"
      ? and(
          eq(buildings.userId, session.userId),
          gte(inspectionSchedules.scheduledDate, monthStart),
          lte(inspectionSchedules.scheduledDate, monthEnd),
          eq(buildings.isApartment, true),
          notManuallyScheduled,
          teamCondition
        )
      : and(
          eq(buildings.userId, session.userId),
          gte(inspectionSchedules.scheduledDate, monthStart),
          lte(inspectionSchedules.scheduledDate, monthEnd),
          isGeneralBuilding,
          eq(inspectionSchedules.inspectionType, category),
          notManuallyScheduled,
          teamCondition
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

  const warnings: string[] = [];

  // 1단계: 유효성 검사 + 점검면적(세대수) 계산 - 동기 작업이라 순서대로 걸러낸다.
  const prepared: { row: (typeof rows)[number]; rawAmount: number }[] = [];
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
    prepared.push({ row, rawAmount });
  }

  // 2단계: 좌표 확보(캐시 없는 건 지오코딩 API 호출) - 건물마다 독립적이라 병렬로 처리한다.
  // 예전엔 한 건씩 순서대로 기다려서, 건물이 많을수록 배치 미리보기가 느려지는 원인이었다.
  const rawBuildings = await Promise.all(
    prepared.map(async ({ row, rawAmount }): Promise<RawCategoryBuilding> => {
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

      return {
        buildingId: row.buildingId,
        inspectionId: row.inspectionId,
        name: row.name,
        inspectionType: row.inspectionType,
        category,
        rawAmount,
        coordinates,
      };
    })
  );

  return { rawBuildings, warnings, found: rows.length > 0 };
}

function toPlacementBuildings(
  rawBuildings: RawCategoryBuilding[],
  dailyLimits: Record<InspectionCategory, number>
): PlacementBuilding[] {
  return rawBuildings.map((b) => ({
    buildingId: b.buildingId,
    inspectionId: b.inspectionId,
    name: b.name,
    inspectionType: b.inspectionType,
    category: b.category,
    rawAmount: b.rawAmount,
    usageRatio: b.rawAmount / dailyLimits[b.category],
    coordinates: b.coordinates,
  }));
}

// 아무리 인원을 늘려도 무한정 탐색하지 않도록 잡아둔 상한. 인원 1명 늘 때마다
// 하루 한도가 크게 늘어나는 계산식이라(예: 종합점검 +2,000㎡), 실무에서 이 상한까지
// 갈 일은 거의 없다 - 그래도 도달하면 "이 정도로도 어려움"으로 보고한다.
const MAX_PERSONNEL_SEARCH = 200;

// 요청한 인원수로는 이번 달 안에 다 못 들어갈 때, 다 들어가는 최소 인원수를
// 찾는다. 인원이 늘수록 하루 한도(dailyLimit)가 커져서 usageRatio가 줄고, 참고
// 소요시간도 같이 줄어들므로 "인원이 늘면 배치가 더 잘 된다"는 단조성이 성립한다
// - 그래서 지수 탐색으로 성립하는 상한을 먼저 찾고 이분탐색으로 좁힌다. 데이터
// 문제(usageRatio<=0)로 못 들어간 건은 인원을 늘려도 해결되지 않으므로, "다
// 들어갔다"는 판정에서는 capacity 사유만 확인한다.
async function findMinimumPersonnelForFullPlacement(
  from: number,
  runPlacement: (
    n: number
  ) => Promise<{ result: PlacementResult; dailyLimits: Record<InspectionCategory, number> }>
): Promise<number | null> {
  async function fits(n: number): Promise<boolean> {
    const { result } = await runPlacement(n);
    return !result.unplaced.some((u) => u.reasonCode === "capacity");
  }

  let lo = from; // from은 이미 capacity 부족이 확인된 상태로 호출됨
  let hi = from + 1;
  while (hi <= MAX_PERSONNEL_SEARCH && !(await fits(hi))) {
    lo = hi;
    hi = hi * 2;
  }
  if (hi > MAX_PERSONNEL_SEARCH) {
    return (await fits(MAX_PERSONNEL_SEARCH)) ? MAX_PERSONNEL_SEARCH : null;
  }

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { month, personnelCount, teamId } = parsed.data;

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, "0")}`;

  const allRawBuildings: RawCategoryBuilding[] = [];
  const allWarnings: string[] = [];
  let anyFound = false;

  try {
    // 세 카테고리는 서로 독립적인 조회+지오코딩이라 병렬로 처리한다 (예전엔
    // 순서대로 기다려서 카테고리 수만큼 느려졌었다).
    const categoryResults = await Promise.all(
      CATEGORIES.map((category) =>
        collectCategoryRawBuildings(session, category, monthStart, monthEnd, teamId)
      )
    );
    for (const r of categoryResults) {
      allRawBuildings.push(...r.rawBuildings);
      allWarnings.push(...r.warnings);
      if (r.found) anyFound = true;
    }
  } catch (err) {
    if (err instanceof KakaoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  if (!anyFound) {
    return NextResponse.json(
      {
        error:
          teamId != null
            ? "해당 월에 이 팀 담당 건물의 예정된 점검이 없습니다."
            : "해당 월에 예정된 점검이 없습니다.",
      },
      { status: 404 }
    );
  }

  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0); // 선택한 달의 마지막 날

  // 추천 인원수 탐색처럼 인원수를 바꿔가며 배치를 여러 번 돌릴 수 있으므로, 건물
  // 쌍 거리를 매번 DB에서 다시 읽지 않도록 이번 요청 동안 메모리에 캐시해서 쓴다.
  const routeCache = await preloadDrivingRoutes(allRawBuildings.map((b) => b.buildingId));
  const getRoute = makeMemoizedDistanceFn(routeCache);

  function dailyLimitsFor(n: number): Record<InspectionCategory, number> {
    const limits = {} as Record<InspectionCategory, number>;
    for (const category of CATEGORIES) limits[category] = getDailyLimit(n, category);
    return limits;
  }

  async function runPlacement(n: number): Promise<{ result: PlacementResult; dailyLimits: Record<InspectionCategory, number> }> {
    const limits = dailyLimitsFor(n);
    const result = await placeInspections(toPlacementBuildings(allRawBuildings, limits), startDate, endDate, getRoute);
    return { result, dailyLimits: limits };
  }

  let dailyLimits: Record<InspectionCategory, number>;
  let placement: PlacementResult;
  try {
    ({ result: placement, dailyLimits } = await runPlacement(personnelCount));
  } catch (err) {
    if (err instanceof CapacityRuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof KakaoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  // 인원 부족(capacity)으로 못 들어간 게 있으면, 인원을 늘려서 다 들어가는 최소
  // 인원을 찾아본다. 데이터 문제(usageRatio<=0)로 못 들어간 건 인원을 늘려도
  // 해결되지 않으므로 탐색 대상에서 제외한다.
  let recommendedPersonnelCount: number | null = null;
  const hasCapacityUnplaced = placement.unplaced.some((u) => u.reasonCode === "capacity");
  if (hasCapacityUnplaced) {
    recommendedPersonnelCount = await findMinimumPersonnelForFullPlacement(
      personnelCount,
      runPlacement
    );
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
      estimatedMinutes: day.estimatedMinutes,
      groups: Array.from(groupsMap.values()),
    };
  });

  const unplaced = placement.unplaced.map((u) => ({
    buildingId: u.buildingId,
    inspectionId: u.inspectionId,
    name: u.name,
    reason: u.reason,
    reasonCode: u.reasonCode,
    category: CATEGORY_LABEL[u.category],
  }));

  // 실제 저장(적용)은 이 라우트에서 하지 않는다 - /api/schedule/apply가 여기서
  // 계산한 days를 그대로 받아 저장만 한다 (재계산 없이 빠르게 적용하기 위함).
  return NextResponse.json({
    days,
    unplaced,
    warnings: allWarnings,
    recommendedPersonnelCount,
  });
}
