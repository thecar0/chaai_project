import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { drivingDistances } from "@/db/schema";
import { getDrivingRoute, type Coordinates, type DrivingRoute } from "./kakao";

/**
 * 두 건물 사이의 실제 주행거리·소요시간을 DB에 캐시해서 재사용한다. 배치
 * 미리보기를 인원수 바꿔가며 여러 번 돌리면 같은 건물 쌍의 거리를 매번 다시
 * API로 조회하게 되는데, 이 값은 시간이 지나도 바뀌지 않으므로 한 번 구하면
 * 계속 재사용한다 (미리보기 속도 개선의 핵심).
 */
export async function getCachedDrivingRoute(
  aBuildingId: number,
  aCoords: Coordinates,
  bBuildingId: number,
  bCoords: Coordinates
): Promise<DrivingRoute | null> {
  if (aBuildingId === bBuildingId) return { distanceKm: 0, durationMinutes: 0 };

  const [idA, idB, coordsA, coordsB] =
    aBuildingId < bBuildingId
      ? [aBuildingId, bBuildingId, aCoords, bCoords]
      : [bBuildingId, aBuildingId, bCoords, aCoords];

  const [cached] = await db
    .select()
    .from(drivingDistances)
    .where(and(eq(drivingDistances.buildingIdA, idA), eq(drivingDistances.buildingIdB, idB)))
    .limit(1);
  if (cached) {
    return { distanceKm: cached.distanceKm, durationMinutes: cached.durationMinutes };
  }

  const route = await getDrivingRoute(coordsA, coordsB);
  if (!route) return null;

  await db
    .insert(drivingDistances)
    .values({
      buildingIdA: idA,
      buildingIdB: idB,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
    })
    .onConflictDoNothing({ target: [drivingDistances.buildingIdA, drivingDistances.buildingIdB] });

  return route;
}

// 추천 인원수 탐색처럼 같은 건물 집합으로 배치를 여러 번 돌릴 때, 건물 쌍마다
// 매번 DB를 왕복하지 않도록 관련된 캐시 값을 한 번에 메모리로 읽어온다.
export async function preloadDrivingRoutes(
  buildingIds: number[]
): Promise<Map<string, DrivingRoute>> {
  const map = new Map<string, DrivingRoute>();
  if (buildingIds.length < 2) return map;

  const rows = await db
    .select()
    .from(drivingDistances)
    .where(
      and(
        inArray(drivingDistances.buildingIdA, buildingIds),
        inArray(drivingDistances.buildingIdB, buildingIds)
      )
    );
  for (const r of rows) {
    map.set(`${r.buildingIdA}-${r.buildingIdB}`, {
      distanceKm: r.distanceKm,
      durationMinutes: r.durationMinutes,
    });
  }
  return map;
}

// preload된 메모리 캐시를 우선 사용하고, 없는 쌍만 DB/API로 조회해 메모리에도
// 채워 넣는 DistanceFn을 만든다 - 같은 요청 안에서 배치를 여러 번(인원수를
// 바꿔가며) 돌려도 같은 쌍을 두 번 조회하지 않게 하기 위함이다.
export function makeMemoizedDistanceFn(
  preloaded: Map<string, DrivingRoute>
): (
  aBuildingId: number,
  aCoords: Coordinates,
  bBuildingId: number,
  bCoords: Coordinates
) => Promise<DrivingRoute | null> {
  return async (aBuildingId, aCoords, bBuildingId, bCoords) => {
    if (aBuildingId === bBuildingId) return { distanceKm: 0, durationMinutes: 0 };
    const [idA, idB] =
      aBuildingId < bBuildingId ? [aBuildingId, bBuildingId] : [bBuildingId, aBuildingId];
    const key = `${idA}-${idB}`;
    const cached = preloaded.get(key);
    if (cached) return cached;

    const route = await getCachedDrivingRoute(aBuildingId, aCoords, bBuildingId, bCoords);
    if (route) preloaded.set(key, route);
    return route;
  };
}
