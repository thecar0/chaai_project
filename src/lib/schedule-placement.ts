import { applyDistanceDegradation, calculateInspectionDays, type InspectionCategory } from "./capacity";
import { getDrivingDistanceKm, type Coordinates } from "./geo/kakao";

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
  usedRatio: number; // 오늘 하루 능력 중 사용한 비율의 합 (0~1)
};

export type PlacementResult = {
  days: PlacementDay[];
  unplaced: (PlacementDayItem & { reason: string })[];
};

type DistanceFn = (a: Coordinates, b: Coordinates) => Promise<number | null>;

/**
 * 대상 건물들을 하루 능력(=1, 100%) 안에서 최대한 채워 날짜별로 배치한다.
 *
 * 종합점검 8,000㎡·작동점검 10,000㎡·아파트 250세대는 "같은 하루치 능력을
 * 서로 다른 기준으로 표현한 것"이라서, 하루에 종합점검 건물 + 작동점검 건물 +
 * 아파트를 섞어서 배치할 수도 있다. 이때는 각 건마다 "자기 유형의 하루 한도
 * 대비 몇 %를 썼는지"(usageRatio = 실제 점검면적(세대수) ÷ 그 유형의 하루 한도)를
 * 계산해서, 하루 사용 비율의 합이 1(=100%)을 넘지 않게 배치한다.
 *
 * - 혼자서도 하루 능력(비율 1)을 넘는 건물(점검일수 > 1)은 다른 건물과 묶지 않고
 *   단독으로 필요한 일수만큼 연속 배치한다.
 * - 나머지는 그리디 최근접 방식으로 하루에 최대한 채운다(유형 상관없이 지리적으로
 *   가까운 순): 직선거리(하버사인)로 가장 가까운 후보를 먼저 추린 뒤, 그 후보에
 *   대해서만 실제 주행거리 API를 호출해 거리 감액을 적용한다.
 * - endDate(선택한 달의 마지막 날)를 넘어가면 더 이상 배치하지 않고 unplaced로
 *   보고한다.
 */
const DAILY_CAPACITY = 1;

const MONTH_OVERFLOW_REASON =
  "이번 달 안에 배치할 수 없습니다 (인원 부족 - 인원수를 늘리거나 다음 달로 넘기세요).";

export async function placeInspections(
  buildings: PlacementBuilding[],
  startDate: Date,
  endDate: Date,
  getDistanceKm: DistanceFn = getDrivingDistanceKm
): Promise<PlacementResult> {
  const days: PlacementDay[] = [];
  const unplaced: PlacementResult["unplaced"] = [];
  let cursor = new Date(startDate);

  const soloPool: PlacementBuilding[] = [];
  const packPool: PlacementBuilding[] = [];

  for (const b of buildings) {
    if (b.usageRatio <= 0) {
      unplaced.push({ ...toItem(b), reason: "점검면적(세대수) 산출값이 0 이하입니다." });
      continue;
    }
    const daysNeeded = calculateInspectionDays(b.usageRatio, DAILY_CAPACITY);
    (daysNeeded > 1 ? soloPool : packPool).push(b);
  }

  // 1) 혼자서도 하루 능력을 넘는 건물부터 연속 배치 (선택한 달을 넘어가면 배치하지 않음)
  for (const b of soloPool) {
    const daysNeeded = calculateInspectionDays(b.usageRatio, DAILY_CAPACITY);
    if (addDays(cursor, daysNeeded - 1) > endDate) {
      unplaced.push({ ...toItem(b), reason: MONTH_OVERFLOW_REASON });
      continue;
    }
    for (let i = 0; i < daysNeeded; i++) {
      days.push({
        date: toDateString(cursor),
        items: [
          {
            ...toItem(b),
            usageRatio: b.usageRatio / daysNeeded,
            rawAmount: b.rawAmount / daysNeeded,
          },
        ],
        usedRatio: DAILY_CAPACITY,
      });
      cursor = addDays(cursor, 1);
    }
  }

  // 2) 나머지는 그리디 최근접 배치로 하루 능력(비율 1)을 채움 - 유형 섞어서 채운다
  const remaining = [...packPool];
  while (remaining.length > 0) {
    if (cursor > endDate) {
      for (const b of remaining) {
        unplaced.push({ ...toItem(b), reason: MONTH_OVERFLOW_REASON });
      }
      break;
    }

    const dayItems: PlacementDayItem[] = [];
    let remainingCapacity = DAILY_CAPACITY;
    let lastCoords: Coordinates | null = null;

    const first = remaining.shift()!;
    dayItems.push(toItem(first));
    remainingCapacity -= first.usageRatio;
    lastCoords = first.coordinates ?? null;

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
      if (lastCoords && candidate.coordinates) {
        distanceKm = (await getDistanceKm(lastCoords, candidate.coordinates)) ?? nearestHaversine;
      }

      const degradedCapacity = applyDistanceDegradation(remainingCapacity, distanceKm);
      if (candidate.usageRatio > degradedCapacity) break; // 오늘은 더 못 채움

      remaining.splice(nearestIdx, 1);
      dayItems.push(toItem(candidate));
      remainingCapacity = degradedCapacity - candidate.usageRatio;
      lastCoords = candidate.coordinates ?? lastCoords;
    }

    days.push({
      date: toDateString(cursor),
      items: dayItems,
      usedRatio: DAILY_CAPACITY - remainingCapacity,
    });
    cursor = addDays(cursor, 1);
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

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
