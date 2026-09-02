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

export type FreeBuildingAssignment = {
  buildingId: number;
  // null = 배정 불가 (건물 좌표가 없거나, 어느 팀도 기준점이 될 고정 건물이 없음)
  assignedTeamId: number | null;
};

/**
 * "고정 담당"으로 지정된 건물들의 좌표 중심점(centroid)을 팀마다 구하고, 나머지
 * (미배정) 건물을 가장 가까운 중심점을 가진 팀에 자동으로 붙인다.
 *
 * 팀마다 고정 건물을 최소 1개는 지정해야 그 팀에게 기준점이 생긴다 - 어느 팀도
 * 기준점이 없으면(고정 건물을 하나도 안 정한 초기 상태) 무작정 인원수 기준
 * 라운드로빈으로 나누지 않는다. 그건 거리 효율과 무관한 배정이라 오히려
 * 사용자가 원한 "거리·시간 효율" 기준을 어기게 되기 때문이다 - 이 경우 사용자가
 * 팀마다 기준 건물을 먼저 지정하도록 안내해야 한다.
 */
export function assignFreeBuildingsByProximity(
  pinnedByTeam: Map<number, Coordinates[]>,
  freeBuildings: { buildingId: number; coordinates: Coordinates | null }[]
): FreeBuildingAssignment[] {
  const anchors = new Map<number, Coordinates>();
  for (const [teamId, coordsList] of pinnedByTeam) {
    const c = centroid(coordsList);
    if (c) anchors.set(teamId, c);
  }

  return freeBuildings.map((b) => {
    if (!b.coordinates || anchors.size === 0) {
      return { buildingId: b.buildingId, assignedTeamId: null };
    }
    let bestTeamId: number | null = null;
    let bestDist = Infinity;
    for (const [teamId, anchor] of anchors) {
      const d = haversineKm(b.coordinates, anchor);
      if (d < bestDist) {
        bestDist = d;
        bestTeamId = teamId;
      }
    }
    return { buildingId: b.buildingId, assignedTeamId: bestTeamId };
  });
}
