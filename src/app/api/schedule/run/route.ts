import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import { CapacityRuleError, getDailyLimit, type InspectionCategory } from "@/lib/capacity";
import { KakaoApiError, type Coordinates } from "@/lib/geo/kakao";
import { preloadDrivingRoutes, makeMemoizedDistanceFn } from "@/lib/geo/distance-cache";
import { assignFreeBuildingsByProximity, countWeekdaysInMonth } from "@/lib/team-auto-assign";
import { placeInspections, type PlacementResult } from "@/lib/schedule-placement";
import {
  CATEGORIES,
  collectCategoryRawBuildings,
  findMinimumPersonnelForFullPlacement,
  formatPlacementResult,
  toPlacementBuildings,
  type RawCategoryBuilding,
} from "@/lib/schedule-collect";

const runSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식이어야 합니다"),
  personnelCount: z.number().int().min(3, "기술인력은 최소 3명부터 계산됩니다"),
  // 팀별로 나눠서 배치할 때 쓴다 - 없으면(전체) 팀 구분 없이 지금까지처럼 동작한다.
  teamId: z.number().int().positive().optional(),
});

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

  // teamId가 있어도(팀 탭에서 배치) 일단 전체 건물을 모은다 - 미배정 건물 중
  // 이 팀 근처에 있는 걸 자동으로 끌어와야 하므로, DB 쿼리 단계에서 팀으로 미리
  // 거르면 그 판단을 할 수 없다.
  const allRawBuildings: RawCategoryBuilding[] = [];
  const allWarnings: string[] = [];
  let anyFound = false;

  try {
    // 세 카테고리는 서로 독립적인 조회+지오코딩이라 병렬로 처리한다 (예전엔
    // 순서대로 기다려서 카테고리 수만큼 느려졌었다).
    const categoryResults = await Promise.all(
      CATEGORIES.map((category) => collectCategoryRawBuildings(session, category, monthStart, monthEnd))
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
    return NextResponse.json({ error: "해당 월에 예정된 점검이 없습니다." }, { status: 404 });
  }

  // 팀 탭에서 배치할 때만: 고정 담당(팀 지정된) 건물들의 위치를 기준으로, 미배정
  // 건물을 가장 가까운 팀에 자동으로 붙인다. "전체" 보기(teamId 없음)는 지금까지처럼
  // 팀 구분 없이 전부 한 풀로 배치한다 - 자동 배정은 특정 팀을 놓고 볼 때만 의미가 있다.
  let placementRawBuildings = allRawBuildings;
  const autoAssignedBuildingIds: number[] = [];
  const unassignableBuildings: { buildingId: number; name: string }[] = [];

  if (teamId != null) {
    // 이 팀 하나만 놓고 계산하면 "가상 기준점"이 미배정 건물 전체를 혼자 다
    // 끌어가버린다(경쟁 상대가 없으니까) - 다른 팀 탭에서 봤을 때와 다른 결과가
    // 나오면 안 되므로, 사용자의 팀 전체를 놓고 같은 배정을 계산한 뒤 이 팀
    // 몫만 골라낸다("전체 배치"와 항상 같은 배정 기준을 쓰게 됨).
    const allTeams = await db.query.teams.findMany({
      where: eq(teams.userId, session.userId),
      columns: { id: true, personnelCount: true },
    });
    if (!allTeams.some((t) => t.id === teamId)) {
      return NextResponse.json({ error: "팀을 찾을 수 없습니다." }, { status: 404 });
    }

    const byBuilding = new Map<number, RawCategoryBuilding[]>();
    for (const b of allRawBuildings) {
      const list = byBuilding.get(b.buildingId) ?? [];
      list.push(b);
      byBuilding.set(b.buildingId, list);
    }
    const uniqueBuildings = Array.from(byBuilding.values()).map((list) => list[0]);

    const pinnedByTeam = new Map<number, Coordinates[]>();
    for (const b of uniqueBuildings) {
      if (b.buildingTeamId == null || !b.coordinates) continue;
      const list = pinnedByTeam.get(b.buildingTeamId) ?? [];
      list.push(b.coordinates);
      pinnedByTeam.set(b.buildingTeamId, list);
    }

    const freeBuildings = uniqueBuildings
      .filter((b) => b.buildingTeamId == null)
      .map((b) => ({
        buildingId: b.buildingId,
        coordinates: b.coordinates,
        demandItems: byBuilding.get(b.buildingId)!.map((r) => ({
          category: r.category,
          rawAmount: r.rawAmount,
        })),
      }));
    const assignments = assignFreeBuildingsByProximity(
      allTeams,
      pinnedByTeam,
      freeBuildings,
      countWeekdaysInMonth(year, monthNum)
    );
    const assignmentByBuildingId = new Map(assignments.map((a) => [a.buildingId, a.assignedTeamId]));

    for (const a of assignments) {
      if (a.assignedTeamId === null) {
        const b = byBuilding.get(a.buildingId)?.[0];
        if (b) unassignableBuildings.push({ buildingId: b.buildingId, name: b.name });
      } else if (a.assignedTeamId === teamId) {
        autoAssignedBuildingIds.push(a.buildingId);
      }
    }

    placementRawBuildings = allRawBuildings.filter((b) => {
      const effectiveTeamId = b.buildingTeamId ?? assignmentByBuildingId.get(b.buildingId) ?? null;
      return effectiveTeamId === teamId;
    });

    if (placementRawBuildings.length === 0) {
      return NextResponse.json(
        { error: "해당 월에 이 팀 담당(고정 또는 근처 미배정) 건물의 예정된 점검이 없습니다." },
        { status: 404 }
      );
    }
  }

  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0); // 선택한 달의 마지막 날

  // 추천 인원수 탐색처럼 인원수를 바꿔가며 배치를 여러 번 돌릴 수 있으므로, 건물
  // 쌍 거리를 매번 DB에서 다시 읽지 않도록 이번 요청 동안 메모리에 캐시해서 쓴다.
  const routeCache = await preloadDrivingRoutes(placementRawBuildings.map((b) => b.buildingId));
  const getRoute = makeMemoizedDistanceFn(routeCache);

  function dailyLimitsFor(n: number): Record<InspectionCategory, number> {
    const limits = {} as Record<InspectionCategory, number>;
    for (const category of CATEGORIES) limits[category] = getDailyLimit(n, category);
    return limits;
  }

  async function runPlacement(n: number): Promise<{ result: PlacementResult; dailyLimits: Record<InspectionCategory, number> }> {
    const limits = dailyLimitsFor(n);
    const result = await placeInspections(
      toPlacementBuildings(placementRawBuildings, limits),
      startDate,
      endDate,
      getRoute
    );
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

  const { days, unplaced } = formatPlacementResult(placement, dailyLimits);

  // 실제 저장(적용)은 이 라우트에서 하지 않는다 - /api/schedule/apply가 여기서
  // 계산한 days를 그대로 받아 저장만 한다 (재계산 없이 빠르게 적용하기 위함).
  // teamId 모드일 때 autoAssignedBuildingIds는 "적용" 시점에 buildings.teamId를
  // 실제로 채워서 이후로도 이 팀 고정 담당이 되도록 클라이언트가 apply에 그대로 넘긴다.
  return NextResponse.json({
    days,
    unplaced,
    warnings: allWarnings,
    recommendedPersonnelCount,
    autoAssignedBuildingIds,
    unassignableBuildings,
  });
}
