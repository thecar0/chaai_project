import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import BuildingsTable, { type BuildingRow } from "@/components/buildings/BuildingsTable";

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: { team?: string };
}) {
  const session = await getSession();

  let rows: BuildingRow[] = [];
  let teams: { id: number; name: string }[] = [];
  if (session) {
    // 점검 상태(예정/이월/완료)는 캘린더의 월별 목록에서만 보여준다 - 여기서는
    // 건물 자체 정보만 다룬다.
    const result = await db.execute(sql`
      SELECT b.id, b.name, b.address,
        to_char(b.use_approval_date, 'YYYY-MM-DD') as "useApprovalDate",
        b.recurring_inspection_month as "recurringInspectionMonth",
        b.team_id as "teamId",
        t.name as "teamName"
      FROM buildings b
      LEFT JOIN teams t ON t.id = b.team_id
      WHERE b.user_id = ${session.userId}
    `);
    rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as BuildingRow[];
    rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const teamResult = await db.execute(sql`
      SELECT id, name FROM teams WHERE user_id = ${session.userId} ORDER BY created_at
    `);
    teams = (Array.isArray(teamResult) ? teamResult : (teamResult as { rows: unknown[] }).rows) as {
      id: number;
      name: string;
    }[];
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">건축물</h1>

      <BuildingsTable buildings={rows} teams={teams} initialTeamFilter={searchParams.team} />
    </div>
  );
}
