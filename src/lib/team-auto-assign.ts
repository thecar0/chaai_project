import { getDailyLimit, type InspectionCategory } from "./capacity";
import type { Coordinates } from "./geo/kakao";

// 사전 필터·거리 감액 계산에 쓰는 것과 같은 방식의 직선거리(하버사인).
function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function centroid(coordsList: Coordinates[]): Coordinates | null {
  if (coordsList.length === 0) return null;
  const lat = coordsList.reduce((sum, c) => sum + c.lat, 0) / coordsList.length;
  const lng = coordsList.reduce((sum, c) => sum + c.lng, 0) / coordsList.length;
  return { lat, lng };
}

// 기존 기준점들과 가장 멀리 떨어진 후보를 고른다(최소거리 최대화) - 새 기준점을
// 뭉치지 않게 넓게 퍼뜨려서 시작하기 위한 것. 기준점이 하나도 없으면(완전
// 초기 상태) 그냥 첫 후보를 쓴다.
function farthestPointFrom(existingAnchors: Coordinates[], candidates: Coordinates[]): Coordinates | null {
  if (candidates.length === 0) return null;
  if (existingAnchors.length === 0) return candidates[0];

  let best = candidates[0];
  let bestMinDist = -Infinity;
  for (const c of candidates) {
    let minDist = Infinity;
    for (const a of existingAnchors) minDist = Math.min(minDist, haversineKm(c, a));
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      best = c;
    }
  }
  return best;
}

// 평일(월~금)만 배치 대상이므로, 그 달의 평일 수가 곧 팀의 "한 달 용량"(하루 능력
// 비율 1을 몇 번 쓸 수 있는지)이 된다.
export function countWeekdaysInMonth(year: number, monthNum: number): number {
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, monthNum - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export type TeamCapacityInfo = { id: number; personnelCount: number };

export type FreeBuildingInput = {
  buildingId: number;
  coordinates: Coordinates | null;
  // 같은 건물이 이번 달에 여러 항목(예: 드물게 종합+작동이 겹치는 경우)을 가질 수
  // 있어 전부 더해야 정확한 부담을 계산할 수 있다.
  demandItems: { category: InspectionCategory; rawAmount: number }[];
  // 지난번 자동 배정으로 이미 어느 팀에 가 있었다면 그 팀 id - 그 팀에 여전히
  // 용량이 남아있으면 우선 그대로 유지한다(매번 이유 없이 재배치되지 않도록).
  // 진짜 미배정이면 undefined.
  currentTeamId?: number;
};

export type FreeBuildingAssignment = {
  buildingId: number;
  // null = 배정 불가 (건물 좌표가 없어서 - 그 외에는 항상 배정된다)
  assignedTeamId: number | null;
};

// 이 건물을 특정 팀(인원수)에 배정했을 때 그 팀의 "한 달 용량"(평일 수)에서
// 얼마를 차지하는지. 인원이 많은 팀일수록 하루 한도(dailyLimit)가 커서 같은
// 건물의 부담이 작게 계산된다 - 그래서 인원 많은 팀이 자연히 더 많이 받게 된다.
function demandFor(items: { category: InspectionCategory; rawAmount: number }[], personnelCount: number): number {
  return items.reduce(
    (sum, item) => sum + item.rawAmount / getDailyLimit(personnelCount, item.category),
    0
  );
}

/**
 * 미배정 건물을 팀에 배정한다. 두 단계로 계산한다.
 *
 * 1) 지역 군집: 고정 담당 건물이 있는 팀은 그 위치의 중심점을 기준점으로 쓰고,
 *    고정 담당이 없는 팀은 미배정 건물들의 분포에서 farthest-point로 가상
 *    기준점을 만든 뒤 몇 차례 다듬는다(팀마다 기준 건물을 반드시 지정해야만
 *    동작하던 이전 방식의 한계를 없앤 것).
 * 2) 용량 고려 배정: 그냥 "가장 가까운 팀"으로만 몰아주면, 인원이 많아서 여유가
 *    있는 팀도 위치가 애매하면 계속 비어있고 근처 소규모 팀만 넘치는 문제가
 *    생긴다. 그래서 건물을 가까운 순으로 하나씩 확정하되, 1순위 팀의 이번 달
 *    용량(평일 수)이 이미 찼으면 capacity가 남은 다음으로 가까운 팀으로 넘긴다 -
 *    인원이 많은 팀은 같은 건물의 부담이 작게 계산되므로 자연히 더 많이 받을 수
 *    있다. 전 팀이 다 차면 그래도 가장 가까운 팀에 배정한다(그 팀은 "인원 부족"
 *    경고로 표시됨).
 *
 *    지난번 자동 배정으로 이미 어느 팀에 가 있던 건물(currentTeamId)은, 그 팀에
 *    여전히 용량이 남아있으면 먼저 그대로 유지한다(거리 순위와 무관하게) - 매달
 *    이유 없이 재배치되는 걸 막기 위해서다. 그 팀이 이미 넘쳤을 때만(예: 3팀은
 *    인원 부족인데 4팀은 여유) 정상적인 "가까운, 용량 남은 팀" 배정으로 넘어가서
 *    다른 팀으로 옮겨진다 - 이게 "인원 부족 팀에서 여유 팀으로 자동으로 넘어가는"
 *    실제 메커니즘이다.
 */
export function assignFreeBuildingsByProximity(
  teams: TeamCapacityInfo[],
  pinnedByTeam: Map<number, Coordinates[]>,
  freeBuildings: FreeBuildingInput[],
  weekdaysInMonth: number
): FreeBuildingAssignment[] {
  const teamIds = teams.map((t) => t.id);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const fixedAnchors = new Map<number, Coordinates>();
  for (const teamId of teamIds) {
    const c = centroid(pinnedByTeam.get(teamId) ?? []);
    if (c) fixedAnchors.set(teamId, c);
  }

  const withCoords = freeBuildings.filter(
    (b): b is FreeBuildingInput & { coordinates: Coordinates } => b.coordinates != null
  );
  const withoutCoords = freeBuildings.filter((b) => b.coordinates == null);

  const anchorlessTeamIds = teamIds.filter((id) => !fixedAnchors.has(id));
  const virtualAnchors = new Map<number, Coordinates>();

  if (anchorlessTeamIds.length > 0 && withCoords.length > 0) {
    // 1) 시드: 기존 기준점들과 최대한 멀리 떨어진 지점부터 하나씩 골라 넓게 퍼뜨린다.
    const seedPool = [...fixedAnchors.values()];
    for (const teamId of anchorlessTeamIds) {
      const seed = farthestPointFrom(
        seedPool,
        withCoords.map((b) => b.coordinates)
      );
      if (!seed) break;
      virtualAnchors.set(teamId, seed);
      seedPool.push(seed);
    }

    // 2) 정제: 순수 거리 기준으로 몇 차례 재군집해서 가상 기준점을 다듬는다
    //    (용량은 아래 3단계에서 따로 고려하므로, 여기서는 지역만 자연스럽게 나눈다).
    const REFINEMENT_ROUNDS = 3;
    for (let round = 0; round < REFINEMENT_ROUNDS; round++) {
      const allAnchors = new Map<number, Coordinates>([...fixedAnchors, ...virtualAnchors]);
      const byTeam = new Map<number, Coordinates[]>();
      for (const b of withCoords) {
        let bestTeamId: number | null = null;
        let bestDist = Infinity;
        for (const [teamId, anchor] of allAnchors) {
          const d = haversineKm(b.coordinates, anchor);
          if (d < bestDist) {
            bestDist = d;
            bestTeamId = teamId;
          }
        }
        if (bestTeamId != null) {
          const list = byTeam.get(bestTeamId) ?? [];
          list.push(b.coordinates);
          byTeam.set(bestTeamId, list);
        }
      }
      for (const teamId of anchorlessTeamIds) {
        const newCentroid = centroid(byTeam.get(teamId) ?? []);
        if (newCentroid) virtualAnchors.set(teamId, newCentroid);
      }
    }
  }

  const allAnchors = new Map<number, Coordinates>([...fixedAnchors, ...virtualAnchors]);

  // 3) 용량 고려 배정: 각 건물의 팀별 거리 순위를 구해 가까운 순으로 정렬하고,
  // 앞에서부터 하나씩 "가장 가까운, 용량 남은 팀"에 확정한다.
  const ranked = withCoords
    .map((b) => ({
      building: b,
      ranking: teamIds
        .filter((id) => allAnchors.has(id))
        .map((id) => ({ teamId: id, dist: haversineKm(b.coordinates, allAnchors.get(id)!) }))
        .sort((x, y) => x.dist - y.dist),
    }))
    .sort((a, b) => (a.ranking[0]?.dist ?? Infinity) - (b.ranking[0]?.dist ?? Infinity));

  const remainingCapacity = new Map(teamIds.map((id) => [id, weekdaysInMonth]));
  const assignmentByBuildingId = new Map<number, number | null>();

  // 0) 우선 유지: 지난번 자동 배정으로 이미 어느 팀에 가 있던 건물은, 그 팀에
  // 아직 용량이 남아있으면 거리 순위를 따지지 않고 그대로 유지한다. 작은
  // 건물(부담이 작은 것)부터 확정해야 "남은 용량"을 최대한 살릴 수 있다.
  const sticky = ranked
    .filter((r) => r.building.currentTeamId != null && remainingCapacity.has(r.building.currentTeamId))
    .sort((a, b) => {
      const teamA = teamById.get(a.building.currentTeamId!)!;
      const teamB = teamById.get(b.building.currentTeamId!)!;
      return (
        demandFor(a.building.demandItems, teamA.personnelCount) -
        demandFor(b.building.demandItems, teamB.personnelCount)
      );
    });
  for (const { building } of sticky) {
    const teamId = building.currentTeamId!;
    const team = teamById.get(teamId)!;
    const demand = demandFor(building.demandItems, team.personnelCount);
    if (remainingCapacity.get(teamId)! >= demand) {
      remainingCapacity.set(teamId, remainingCapacity.get(teamId)! - demand);
      assignmentByBuildingId.set(building.buildingId, teamId);
    }
  }

  for (const { building, ranking } of ranked) {
    if (assignmentByBuildingId.has(building.buildingId)) continue; // 0단계에서 이미 유지됨
    if (ranking.length === 0) {
      assignmentByBuildingId.set(building.buildingId, null);
      continue;
    }
    let chosen: number | null = null;
    for (const { teamId } of ranking) {
      const team = teamById.get(teamId)!;
      const demand = demandFor(building.demandItems, team.personnelCount);
      if (remainingCapacity.get(teamId)! >= demand) {
        chosen = teamId;
        remainingCapacity.set(teamId, remainingCapacity.get(teamId)! - demand);
        break;
      }
    }
    if (chosen == null) {
      // 모든 팀 용량이 이미 찼어도 배치는 되어야 하니 그래도 가장 가까운 팀에 배정한다
      // (그 팀은 인원 부족으로 표시되고, 사용자가 인원을 늘리거나 재배정하면 된다).
      chosen = ranking[0].teamId;
      const team = teamById.get(chosen)!;
      remainingCapacity.set(chosen, remainingCapacity.get(chosen)! - demandFor(building.demandItems, team.personnelCount));
    }
    assignmentByBuildingId.set(building.buildingId, chosen);
  }

  const assignments: FreeBuildingAssignment[] = withCoords.map((b) => ({
    buildingId: b.buildingId,
    assignedTeamId: assignmentByBuildingId.get(b.buildingId) ?? null,
  }));
  for (const b of withoutCoords) {
    assignments.push({ buildingId: b.buildingId, assignedTeamId: null });
  }

  return assignments;
}
