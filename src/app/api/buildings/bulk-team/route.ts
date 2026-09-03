import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings, teams } from "@/db/schema";
import { getSession } from "@/lib/session";

const bulkTeamSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "건축물을 선택해주세요"),
  // null이면 미배정으로 해제.
  teamId: z.number().int().positive().nullable(),
});

// 건축물 목록에서 여러 건물을 골라 담당 팀을 한 번에 바꾼다 (거리·규모 보고
// 팀을 재배정하는 실무 흐름 지원용 - 건물 하나하나 수정 페이지를 열 필요 없음).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = bulkTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.teamId !== null) {
    const team = await db.query.teams.findFirst({
      where: and(eq(teams.id, parsed.data.teamId), eq(teams.userId, session.userId)),
    });
    if (!team) return NextResponse.json({ error: "팀을 찾을 수 없습니다." }, { status: 404 });
  }

  // 사용자가 목록에서 직접 고른 것이니 "고정" 담당으로 취급한다 - 이후 자동
  // 배치가 다른 팀으로 재검토하지 않는다.
  const updated = await db
    .update(buildings)
    .set({ teamId: parsed.data.teamId, teamAssignedAuto: false })
    .where(and(inArray(buildings.id, parsed.data.ids), eq(buildings.userId, session.userId)))
    .returning({ id: buildings.id });

  return NextResponse.json({ updatedCount: updated.length });
}
