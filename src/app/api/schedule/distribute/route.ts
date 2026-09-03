import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import { CapacityRuleError, getDailyLimit, type InspectionCategory } from "@/lib/capacity";
import { KakaoApiError, type Coordinates } from "@/lib/geo/kakao";
import { preloadDrivingRoutes, makeMemoizedDistanceFn } from "@/lib/geo/distance-cache";
import { assignFreeBuildingsByProximity } from "@/lib/team-auto-assign";
import { placeInspections, type PlacementResult } from "@/lib/schedule-placement";
import {
  CATEGORIES,
  collectCategoryRawBuildings,
  findTrueMinimumPersonnel,
  formatPlacementResult,
  toPlacementBuildings,
  type RawCategoryBuilding,
} from "@/lib/schedule-collect";

const distributeSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식이어야 합니다"),
  teamIds: z.array(z.number().int().positive()).min(1, "포함할 팀을 1개 이상 선택해주세요"),
});

// "전체 배치" - 체크한 팀들에게 그 달의 건물 전체를 한 번에 나눠 배치한다.
// 고정 담당(buildings.teamId)이 있는 건물은 그 팀으로, 미배정 건물은 체크한
// 팀들의 고정 건물 위치를 기준으로 거리 기준 자동 배정한 뒤, 팀마다 자기
// 인원수(teams.personnelCount)로 독립적으로 배치를 돌린다.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = distributeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { month, teamIds } = parsed.data;

  const selectedTeams = await db
    .select({ id: teams.id, name: teams.name, personnelCount: teams.personnelCount })
    .from(teams)
    .where(and(eq(teams.userId, session.userId), inArray(teams.id, teamIds)));
  if (selectedTeams.length !== teamIds.length) {
    return NextResponse.json({ error: "선택한 팀 중 일부를 찾을 수 없습니다." }, { status: 404 });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, "0")}`;

  const allRawBuildings: RawCategoryBuilding[] = [];
  const allWarnings: string[] = [];
  let anyFound = false;

  try {
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

  const selectedTeamIdSet = new Set(teamIds);
  const byBuilding = new Map<number, RawCategoryBuilding>();
  for (const b of allRawBuildings) if (!byBuilding.has(b.buildingId)) byBuilding.set(b.buildingId, b);
  const uniqueBuildings = Array.from(byBuilding.values());

  // 선택한 팀들의 고정 담당 건물만 기준점(anchor) 후보가 된다 - 체크 안 한 팀의
  // 고정 건물은 이번 배치 대상에서 아예 빠진다(그 팀 자체가 이번 실행에 없으므로).
  const pinnedByTeam = new Map<number, Coordinates[]>();
  for (const b of uniqueBuildings) {
    if (b.buildingTeamId == null || !selectedTeamIdSet.has(b.buildingTeamId) || !b.coordinates) continue;
    const list = pinnedByTeam.get(b.buildingTeamId) ?? [];
    list.push(b.coordinates);
    pinnedByTeam.set(b.buildingTeamId, list);
  }

  const freeBuildings = uniqueBuildings
    .filter((b) => b.buildingTeamId == null)
    .map((b) => ({ buildingId: b.buildingId, coordinates: b.coordinates }));
  const assignments = assignFreeBuildingsByProximity(teamIds, pinnedByTeam, freeBuildings);
  const assignmentByBuildingId = new Map(assignments.map((a) => [a.buildingId, a.assignedTeamId]));

  const unassignableBuildings: { buildingId: number; name: string }[] = [];
  for (const a of assignments) {
    if (a.assignedTeamId === null) {
      const b = byBuilding.get(a.buildingId);
      if (b) unassignableBuildings.push({ buildingId: b.buildingId, name: b.name });
    }
  }

  function effectiveTeamId(b: RawCategoryBuilding): number | null {
    if (b.buildingTeamId != null) {
      return selectedTeamIdSet.has(b.buildingTeamId) ? b.buildingTeamId : null;
    }
    return assignmentByBuildingId.get(b.buildingId) ?? null;
  }

  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0);

  // 건물 쌍 거리를 팀마다 따로 조회하지 않도록, 이번 요청에 관련된 건물 전체를
  // 한 번에 preload해서 모든 팀 계산이 같은 메모리 캐시를 공유하게 한다.
  const relevantBuildingIds = uniqueBuildings
    .filter((b) => effectiveTeamId(b) != null)
    .map((b) => b.buildingId);
  const routeCache = await preloadDrivingRoutes(relevantBuildingIds);
  const getRoute = makeMemoizedDistanceFn(routeCache);

  function dailyLimitsFor(n: number): Record<InspectionCategory, number> {
    const limits = {} as Record<InspectionCategory, number>;
    for (const category of CATEGORIES) limits[category] = getDailyLimit(n, category);
    return limits;
  }

  const teamResults: {
    teamId: number;
    teamName: string;
    personnelCount: number;
    days: ReturnType<typeof formatPlacementResult>["days"];
    unplaced: ReturnType<typeof formatPlacementResult>["unplaced"];
    autoAssignedBuildingIds: number[];
    trueMinimumPersonnel: number | null;
    // "understaffed": 지금 인원으론 못 다 채움 (더 필요) / "overstaffed": 지금보다
    // 적은 인원으로도 다 들어감 (여유) / null: 적정
    warning: "understaffed" | "overstaffed" | null;
  }[] = [];

  try {
    for (const team of selectedTeams) {
      const teamRawBuildings = allRawBuildings.filter((b) => effectiveTeamId(b) === team.id);
      const autoAssignedBuildingIds = uniqueBuildings
        .filter((b) => b.buildingTeamId == null && effectiveTeamId(b) === team.id)
        .map((b) => b.buildingId);

      if (teamRawBuildings.length === 0) {
        teamResults.push({
          teamId: team.id,
          teamName: team.name,
          personnelCount: team.personnelCount,
          days: [],
          unplaced: [],
          autoAssignedBuildingIds: [],
          trueMinimumPersonnel: null,
          warning: null,
        });
        continue;
      }

      async function runPlacement(
        n: number
      ): Promise<{ result: PlacementResult; dailyLimits: Record<InspectionCategory, number> }> {
        const limits = dailyLimitsFor(n);
        const result = await placeInspections(
          toPlacementBuildings(teamRawBuildings, limits),
          startDate,
          endDate,
          getRoute
        );
        return { result, dailyLimits: limits };
      }

      const { result: placement, dailyLimits } = await runPlacement(team.personnelCount);
      const { days, unplaced } = formatPlacementResult(placement, dailyLimits);

      const trueMinimumPersonnel = await findTrueMinimumPersonnel(runPlacement);
      let warning: "understaffed" | "overstaffed" | null = null;
      if (trueMinimumPersonnel != null) {
        if (trueMinimumPersonnel > team.personnelCount) warning = "understaffed";
        else if (trueMinimumPersonnel < team.personnelCount) warning = "overstaffed";
      }

      teamResults.push({
        teamId: team.id,
        teamName: team.name,
        personnelCount: team.personnelCount,
        days,
        unplaced,
        autoAssignedBuildingIds,
        trueMinimumPersonnel,
        warning,
      });
    }
  } catch (err) {
    if (err instanceof CapacityRuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof KakaoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  return NextResponse.json({
    teams: teamResults,
    unassignableBuildings,
    warnings: allWarnings,
  });
}
