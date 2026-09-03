import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, inspectionSchedules, teams } from "@/db/schema";
import { getSession } from "@/lib/session";

// 캘린더 표시용: 로그인한 사용자의 모든 건축물에 대한 점검 일정을 반환
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: inspectionSchedules.id,
      inspectionType: inspectionSchedules.inspectionType,
      scheduledDate: inspectionSchedules.scheduledDate,
      durationDays: inspectionSchedules.durationDays,
      status: inspectionSchedules.status,
      isManuallyScheduled: inspectionSchedules.isManuallyScheduled,
      buildingId: buildings.id,
      buildingName: buildings.name,
      teamId: buildings.teamId,
      teamName: teams.name,
    })
    .from(inspectionSchedules)
    .innerJoin(buildings, eq(inspectionSchedules.buildingId, buildings.id))
    .leftJoin(teams, eq(buildings.teamId, teams.id))
    .where(eq(buildings.userId, session.userId));

  return NextResponse.json({ inspections: rows });
}
