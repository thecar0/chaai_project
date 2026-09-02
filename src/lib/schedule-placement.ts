import {
  applyDistanceDegradation,
  calculateInspectionDays,
  estimateWorkMinutes,
  REFERENCE_WORK_MINUTES,
  type InspectionCategory,
} from "./capacity";
import { getCachedDrivingRoute } from "./geo/distance-cache";
import type { Coordinates } from "./geo/kakao";

export type PlacementBuilding = {
  buildingId: number;
  inspectionId: number;
  name: string;
  inspectionType: "comprehensive" | "operational";
  category: InspectionCategory; // 종합/작동/아파트 - 표시 분류용
  rawAmount: number; // 실제 점검면적(㎡) 또는 세대수 - 표시용
  usageRatio: number; // 그 유형의 하루 한도 대비 사용 비율(0~1) - 배치 계산에 실제로 쓰이는 값
  coordinates: Coordinates | null; // 지오코딩 실패 시 null (거리를 알 수 없으므로 항상 새 날의 시작 건물로만 배치됨)
};

export type PlacementDayItem = {
  buildingId: number;
  inspectionId: number;
  name: string;
  inspectionType: "comprehensive" | "operational";
  category: InspectionCategory;
  rawAmount: number;
  usageRatio: number;
};

export type PlacementDay = {
  date: string;
  items: PlacementDayItem[];
  usedRatio: number; // 오늘 하루 능력(법정 한도) 중 사용한 비율의 합 (0~1)
  // 참고용 예상 소요시간(이동시간 포함, 분) - 법정 기준 아님. 법정 한도를 다
  // 채워도 이게 REFERENCE_WORK_MINUTES를 넘지 않는다는 보장은 아래 배치
  // 로직이 별도로 확인한다(둘 다 만족해야 그 날에 들어간다).
  estimatedMinutes: number;
};

export type UnplacedReasonCode = "capacity" | "invalid_amount";

export type PlacementResult = {
  days: PlacementDay[];
  unplaced: (PlacementDayItem & { reason: string; reasonCode: UnplacedReasonCode })[];
};

type DistanceFn = (
  aBuildingId: number,
  a: Coordinates,
  bBuildingId: number,
  b: Coordinates
) => Promise<{ distanceKm: number; durationMinutes: number } | null>;

// 실제 경로를 못 구했을 때(API 실패 등) 직선거리로 대략 이동시간을 추정하는 데
// 쓰는 참고용 평균 속도 - 법정 기준이 아니라 순전히 대략치 추정용이다.
const FALLBACK_AVERAGE_SPEED_KMH = 30;

/**
 * 대상 건물들을 하루 능력(=1, 100%) 안에서 최대한 채워 날짜별로 배치한다.
 * 주말(토·일)은 점검을 배치하지 않는다 - 평일에만 배치되고, 시작일이나 이월된
 * 날짜가 주말이면 다음 평일로 넘어간다.
 *
 * 종합점검 8,000㎡·작동점검 10,000㎡·아파트 250세대는 "같은 하루치 능력을
 * 서로 다른 기준으로 표현한 것"이라서, 하루에 종합점검 건물 + 작동점검 건물 +
 * 아파트를 섞어서 배치할 수도 있다. 이때는 각 건마다 "자기 유형의 하루 한도
 * 대비 몇 %를 썼는지"(usageRatio = 실제 점검면적(세대수) ÷ 그 유형의 하루 한도)를
 * 계산해서, 하루 사용 비율의 합이 1(=100%)을 넘지 않게 배치한다.
 *
 * 다만 법정 한도(면적·세대수 상한)와 "근무시간(점심 제외) 안에 실제로 끝나는지"는
 * 서로 다른 문제다 - 법정 한도는 지키더라도 이동시간까지 더하면 하루 안에 못
 * 끝날 수 있다. 그래서 법정 한도(usageRatio 합 ≤ 1)와는 별개로, 참고용
 * 소요시간(작업시간 추정치 + 실제 이동시간)의 합이 REFERENCE_WORK_MINUTES(420분,
 * 점심 제외 통상 가용시간)를 넘지 않는지도 같이 확인한다 - 둘 중 하나라도
 * 넘으면 그 건은 오늘 못 들어간다. 이 시간 기준은 법령이 아니라 "법정 한도를
 * 통상 가용시간 안에 다 쓴다"고 가정한 참고 페이스일 뿐이다.
 *
 * - 혼자서도 하루 능력(비율 1)을 넘는 건물(점검일수 > 1)은 다른 건물과 묶지 않고
 *   단독으로 필요한 일수만큼 연속(평일 기준) 배치한다.
 * - 나머지는 그리디 최근접 방식으로 하루에 최대한 채운다(유형 상관없이 지리적으로
 *   가까운 순): 직선거리(하버사인)로 가장 가까운 후보를 먼저 추린 뒤, 그 후보에
 *   대해서만 실제 주행거리·소요시간 API를 호출해 거리 감액과 시간 확인을 적용한다.
 * - endDate(선택한 달의 마지막 날)를 넘어가면 더 이상 배치하지 않고 unplaced로
 *   보고한다.
 */
const DAILY_CAPACITY = 1;

const MONTH_OVERFLOW_REASON =
  "이번 달 안에 배치할 수 없습니다 (인원 부족 - 인원수를 늘리거나 다음 달로 넘기세요).";

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// 주말이면 다음 평일로 넘긴다 (시작일 보정용).
function toWeekday(d: Date): Date {
  const copy = new Date(d);
  while (isWeekend(copy)) copy.setDate(copy.getDate() + 1);
  return copy;
}

// 하루 전진하되, 그 결과가 주말이면 다음 평일까지 계속 넘긴다.
function nextWeekday(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + 1);
  return toWeekday(copy);
}

// start(평일이라고 가정)로부터 평일 기준으로 steps번 전진한 날짜.
function weekdayAfterSteps(start: Date, steps: number): Date {
  let d = new Date(start);
  for (let i = 0; i < steps; i++) d = nextWeekday(d);
  return d;
}

export async function placeInspections(
  buildings: PlacementBuilding[],
  startDate: Date,
  endDate: Date,
  getRoute: DistanceFn = getCachedDrivingRoute
): Promise<PlacementResult> {
  const days: PlacementDay[] = [];
  const unplaced: PlacementResult["unplaced"] = [];
  let cursor = toWeekday(new Date(startDate));

  const soloPool: PlacementBuilding[] = [];
  const packPool: PlacementBuilding[] = [];

  for (const b of buildings) {
    if (b.usageRatio <= 0) {
      unplaced.push({
        ...toItem(b),
        reason: "점검면적(세대수) 산출값이 0 이하입니다.",
        reasonCode: "invalid_amount",
      });
      continue;
    }
    const daysNeeded = calculateInspectionDays(b.usageRatio, DAILY_CAPACITY);
    (daysNeeded > 1 ? soloPool : packPool).push(b);
  }

  // 1) 혼자서도 하루 능력을 넘는 건물부터 연속(평일 기준) 배치 (선택한 달을 넘어가면 배치하지 않음)
  for (const b of soloPool) {
    const daysNeeded = calculateInspectionDays(b.usageRatio, DAILY_CAPACITY);
    if (weekdayAfterSteps(cursor, daysNeeded - 1) > endDate) {
      unplaced.push({ ...toItem(b), reason: MONTH_OVERFLOW_REASON, reasonCode: "capacity" });
      continue;
    }
    for (let i = 0; i < daysNeeded; i++) {
      const dayRatio = b.usageRatio / daysNeeded;
      days.push({
        date: toDateString(cursor),
        items: [
          {
            ...toItem(b),
            usageRatio: dayRatio,
            rawAmount: b.rawAmount / daysNeeded,
          },
        ],
        usedRatio: DAILY_CAPACITY,
        estimatedMinutes: estimateWorkMinutes(dayRatio),
      });
      cursor = nextWeekday(cursor);
    }
  }

  // 2) 나머지는 그리디 최근접 배치로 하루 능력(비율 1)을 채움 - 유형 섞어서 채운다
  const remaining = [...packPool];
  while (remaining.length > 0) {
    if (cursor > endDate) {
      for (const b of remaining) {
        unplaced.push({ ...toItem(b), reason: MONTH_OVERFLOW_REASON, reasonCode: "capacity" });
      }
      break;
    }

    const dayItems: PlacementDayItem[] = [];
    let remainingCapacity = DAILY_CAPACITY;
    let remainingMinutes = REFERENCE_WORK_MINUTES;
    let lastCoords: Coordinates | null = null;
    let lastBuildingId: number | null = null;

    const first = remaining.shift()!;
    dayItems.push(toItem(first));
    remainingCapacity -= first.usageRatio;
    remainingMinutes -= estimateWorkMinutes(first.usageRatio);
    lastCoords = first.coordinates ?? null;
    lastBuildingId = first.buildingId;

    while (remaining.length > 0) {
      // 직선거리로 가장 가까운 후보를 먼저 고른다 (API 호출량 절약용 사전 필터)
      let nearestIdx = -1;
      let nearestHaversine = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const h = haversineKm(lastCoords, remaining[i].coordinates);
        if (h < nearestHaversine) {
          nearestHaversine = h;
          nearestIdx = i;
        }
      }
      if (nearestIdx === -1) break;

      const candidate = remaining[nearestIdx];
      let distanceKm = 0;
      let travelMinutes = 0;
      if (lastCoords && candidate.coordinates && lastBuildingId != null) {
        const route = await getRoute(lastBuildingId, lastCoords, candidate.buildingId, candidate.coordinates);
        if (route) {
          distanceKm = route.distanceKm;
          travelMinutes = route.durationMinutes;
        } else {
          // 실제 경로를 못 구하면 직선거리 기준 평균 속도로 대략만 추정한다 (참고용).
          distanceKm = nearestHaversine;
          travelMinutes = (nearestHaversine / FALLBACK_AVERAGE_SPEED_KMH) * 60;
        }
      }

      const degradedCapacity = applyDistanceDegradation(remainingCapacity, distanceKm);
      const candidateMinutes = estimateWorkMinutes(candidate.usageRatio) + travelMinutes;
      const exceedsLegalLimit = candidate.usageRatio > degradedCapacity;
      const exceedsWorkHours = candidateMinutes > remainingMinutes;
      if (exceedsLegalLimit || exceedsWorkHours) break; // 오늘은 더 못 채움

      remaining.splice(nearestIdx, 1);
      dayItems.push(toItem(candidate));
      remainingCapacity = degradedCapacity - candidate.usageRatio;
      remainingMinutes -= candidateMinutes;
      lastCoords = candidate.coordinates ?? lastCoords;
      lastBuildingId = candidate.buildingId;
    }

    days.push({
      date: toDateString(cursor),
      items: dayItems,
      usedRatio: DAILY_CAPACITY - remainingCapacity,
      estimatedMinutes: REFERENCE_WORK_MINUTES - remainingMinutes,
    });
    cursor = nextWeekday(cursor);
  }

  return { days, unplaced };
}

function toItem(b: PlacementBuilding): PlacementDayItem {
  return {
    buildingId: b.buildingId,
    inspectionId: b.inspectionId,
    name: b.name,
    inspectionType: b.inspectionType,
    category: b.category,
    rawAmount: b.rawAmount,
    usageRatio: b.usageRatio,
  };
}

// 사전 필터용 직선거리. 좌표를 모르면 거리를 알 수 없으므로 최우선 후보에서 제외한다.
function haversineKm(a: Coordinates | null, b: Coordinates | null): number {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
