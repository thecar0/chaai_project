import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import TeamManager from "@/components/teams/TeamManager";

export default async function TeamsPage() {
  const session = await getSession();
  const rows = session
    ? await db
        .select({
          id: teams.id,
          name: teams.name,
          personnelCount: teams.personnelCount,
          buildingCount: sql<number>`count(${buildings.id})::int`,
        })
        .from(teams)
        .leftJoin(buildings, eq(buildings.teamId, teams.id))
        .where(eq(teams.userId, session.userId))
        .groupBy(teams.id)
        .orderBy(teams.createdAt)
    : [];

  const [unassigned] = session
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(buildings)
        .where(sql`${buildings.userId} = ${session.userId} and ${buildings.teamId} is null`)
    : [{ count: 0 }];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">팀 관리</h1>
        <p className="mt-1 max-w-xl text-[13px] text-silver-500">
          건물이 많아지면 인원을 소규모 팀으로 나눠 담당 건물만 따로 배치하는 게
          효율적입니다. 꼭 특정 팀이 맡아야 하는 건물만 건축물 목록에서 담당 팀으로
          지정하고, 나머지는 배치할 때 거리 기준으로 자동으로 나눠 배치됩니다.
        </p>
      </div>
      <TeamManager initialTeams={rows} unassignedCount={unassigned?.count ?? 0} />
    </div>
  );
}
