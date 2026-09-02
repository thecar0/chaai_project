import { and, eq } from "drizzle-orm";
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
