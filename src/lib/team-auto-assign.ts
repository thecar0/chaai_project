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

export type FreeBuildingAssignment = {
  buildingId: number;
  // null = 배정 불가 (건물 좌표가 없어서 - 그 외에는 항상 배정된다)
  assignedTeamId: number | null;
};

/**
 * 미배정 건물을 팀에 거리 기준으로 자동 배정한다.
 *
 * - 고정 담당 건물이 있는 팀은 그 건물들의 좌표 중심점(centroid)을 기준점으로
 *   쓴다 (건물이 늘어나도 이 기준점은 안 바뀜 - 담당자가 직접 정한 건물이니까).
 * - 고정 담당 건물이 하나도 없는 팀(들어온 지 얼마 안 됐거나 아직 아무것도 안
 *   정한 팀)도 배치가 되어야 하므로, 미배정 건물들의 좌표 분포에서 farthest-point
 *   방식으로 가상 기준점을 만들어준다 - 팀마다 기준 건물을 반드시 지정해야만
 *   동작하던 이전 방식의 한계를 없앤 것.
 * - 가상 기준점은 초기 배정 결과를 보고 몇 차례 다시 계산(그 팀에 배정된 건물들의
 *   중심으로 이동)해서 더 고르게 나뉘도록 다듬는다(Lloyd's algorithm과 같은
 *   방식). 고정 기준점은 이 과정에서 움직이지 않는다.
 * - 좌표가 아예 없는 건물만 배정 불가로 남는다.
 */
export function assignFreeBuildingsByProximity(
  teamIds: number[],
  pinnedByTeam: Map<number, Coordinates[]>,
  freeBuildings: { buildingId: number; coordinates: Coordinates | null }[]
): FreeBuildingAssignment[] {
  const fixedAnchors = new Map<number, Coordinates>();
  for (const teamId of teamIds) {
    const c = centroid(pinnedByTeam.get(teamId) ?? []);
    if (c) fixedAnchors.set(teamId, c);
  }

  const withCoords = freeBuildings.filter(
    (b): b is { buildingId: number; coordinates: Coordinates } => b.coordinates != null
  );
  const withoutCoords = freeBuildings.filter((b) => b.coordinates == null);

  const anchorlessTeamIds = teamIds.filter((id) => !fixedAnchors.has(id));
  const virtualAnchors = new Map<number, Coordinates>();

  if (anchorlessTeamIds.length > 0 && withCoords.length > 0) {
    // 1) 시드: 기존 기준점들과 최대한 멀리 떨어진 지점부터 하나씩 골라 넓게 퍼뜨린다.
    const seedPool = [...fixedAnchors.values()];
    for (const teamId of anchorlessTeamIds) {
      const seed = farthestPointFrom(seedPool, withCoords.map((b) => b.coordinates));
      if (!seed) break;
      virtualAnchors.set(teamId, seed);
      seedPool.push(seed);
    }

    // 2) 정제: 가상 기준점을 실제 배정 결과의 중심으로 몇 차례 옮겨서 더 고르게 나눈다.
    //    고정 기준점(fixedAnchors)은 손대지 않는다.
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

  const assignments: FreeBuildingAssignment[] = withCoords.map((b) => {
    if (allAnchors.size === 0) return { buildingId: b.buildingId, assignedTeamId: null };
    let bestTeamId: number | null = null;
    let bestDist = Infinity;
    for (const [teamId, anchor] of allAnchors) {
      const d = haversineKm(b.coordinates, anchor);
      if (d < bestDist) {
        bestDist = d;
        bestTeamId = teamId;
      }
    }
    return { buildingId: b.buildingId, assignedTeamId: bestTeamId };
  });

  for (const b of withoutCoords) {
    assignments.push({ buildingId: b.buildingId, assignedTeamId: null });
  }

  return assignments;
}
