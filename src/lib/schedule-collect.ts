import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import type { SessionPayload } from "@/lib/jwt";
import { calculateApartmentEffectiveUnits, calculateInspectionArea, type InspectionCategory } from "@/lib/capacity";
import { geocodeAddress, type Coordinates } from "@/lib/geo/kakao";
import type { PlacementBuilding, PlacementDayItem, PlacementResult } from "@/lib/schedule-placement";

// 배치 라우트(/api/schedule/run, /api/schedule/distribute)가 공통으로 쓰는
// "건물 수집 + 인원수별 usageRatio 계산 + 최소 인원 탐색" 로직. 한 팀만 배치하는
// 경우와 여러 팀에 자동으로 나눠 배치하는 경우가 이 부분을 그대로 재사용한다.

export const CATEGORIES: InspectionCategory[] = ["comprehensive", "operational", "apartment"];
export const CATEGORY_LABEL: Record<InspectionCategory, string> = {
  comprehensive: "종합점검",
  operational: "작동점검",
  apartment: "아파트",
};

// usageRatio(그 유형의 하루 한도 대비 사용 비율)는 인원수(dailyLimit)에 따라
// 달라지므로, DB 조회·지오코딩처럼 인원수와 무관하게 한 번만 하면 되는 작업과
// 분리했다 - 추천 인원수를 찾을 때 인원수를 바꿔가며 배치를 여러 번 돌려야
// 하는데, 그때마다 DB/지오코딩을 다시 하면 느려진다.
export type RawCategoryBuilding = {
  inspectionId: number;
  buildingId: number;
  name: string;
  inspectionType: "comprehensive" | "operational";
  category: InspectionCategory;
  rawAmount: number;
  coordinates: Coordinates | null;
  // 이 건물이 현재 "고정 담당"으로 지정된 팀 - null이면 미배정(자동 배정 대상).
  buildingTeamId: number | null;
};

// 팀 필터 없이 항상 전체 건물을 모은다 - 팀별 배정은 DB 쿼리 단계가 아니라
// 호출부에서 (거리 기준 자동 배정 계산 이후에) 결정한다. 쿼리에서 미리 걸러버리면
// "이 팀 근처에 있는 미배정 건물"을 알아낼 방법이 없어진다.
export async function collectCategoryRawBuildings(
  session: SessionPayload,
  category: InspectionCategory,
  monthStart: string,
  monthEnd: string
): Promise<{ rawBuildings: RawCategoryBuilding[]; warnings: string[]; found: boolean }> {
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
      teamId: buildings.teamId,
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
        buildingTeamId: row.teamId,
      };
    })
  );

  return { rawBuildings, warnings, found: rows.length > 0 };
}

export function toPlacementBuildings(
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

export type RunPlacementFn = (
  n: number
) => Promise<{ result: PlacementResult; dailyLimits: Record<InspectionCategory, number> }>;

// 아무리 인원을 늘려도 무한정 탐색하지 않도록 잡아둔 상한. 인원 1명 늘 때마다
// 하루 한도가 크게 늘어나는 계산식이라(예: 종합점검 +2,000㎡), 실무에서 이 상한까지
// 갈 일은 거의 없다 - 그래도 도달하면 "이 정도로도 어려움"으로 보고한다.
export const MAX_PERSONNEL_SEARCH = 200;

// 요청한 인원수로는 이번 달 안에 다 못 들어갈 때, 다 들어가는 최소 인원수를
// 찾는다. 인원이 늘수록 하루 한도(dailyLimit)가 커져서 usageRatio가 줄고, 참고
// 소요시간도 같이 줄어들므로 "인원이 늘면 배치가 더 잘 된다"는 단조성이 성립한다
// - 그래서 지수 탐색으로 성립하는 상한을 먼저 찾고 이분탐색으로 좁힌다. 데이터
// 문제(usageRatio<=0)로 못 들어간 건은 인원을 늘려도 해결되지 않으므로, "다
// 들어갔다"는 판정에서는 capacity 사유만 확인한다.
//
// from은 호출부가 이미 "capacity 부족이 확인된 인원수"로 넘겨야 한다(그 지점부터
// 탐색을 시작). 절대 최소치(3명부터)를 모르는 상태에서 찾으려면 findTrueMinimumPersonnel을 쓴다.
export async function findMinimumPersonnelForFullPlacement(
  from: number,
  runPlacement: RunPlacementFn
): Promise<number | null> {
  async function fits(n: number): Promise<boolean> {
    const { result } = await runPlacement(n);
    return !result.unplaced.some((u) => u.reasonCode === "capacity");
  }

  let lo = from;
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

// 요청한 인원수와 무관하게, "이번 달 안에 다 들어가는 절대 최소 인원수"(3명
// 이상)를 찾는다. 여러 팀에 자동으로 나눠 배치할 때, 팀별 기본 인원수가 남는지
// (너무 여유로운지)/모자란지 판단하는 기준으로 쓴다.
export async function findTrueMinimumPersonnel(runPlacement: RunPlacementFn): Promise<number | null> {
  const { result: at3 } = await runPlacement(3);
  const fitsAt3 = !at3.unplaced.some((u) => u.reasonCode === "capacity");
  if (fitsAt3) return 3;
  return findMinimumPersonnelForFullPlacement(3, runPlacement);
}

// PlacementResult(내부 계산 형태)를 화면에 보여줄 날짜별·카테고리별 그룹 형태로
// 바꾼다 - 실제 배치는 유형과 무관하게 하루 능력(비율 1) 기준으로 이미 끝났고,
// 이건 순전히 표시용 재그룹핑이다. /api/schedule/run과 /api/schedule/distribute가
// 동일하게 쓴다.
export function formatPlacementResult(
  placement: PlacementResult,
  dailyLimits: Record<InspectionCategory, number>
) {
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

  return { days, unplaced };
}
