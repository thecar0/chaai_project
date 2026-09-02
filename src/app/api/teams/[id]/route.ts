import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import { teamSchema } from "@/lib/validators";

async function getOwnedTeam(userId: number, id: number) {
  return db.query.teams.findFirst({ where: and(eq(teams.id, id), eq(teams.userId, userId)) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const team = await getOwnedTeam(session.userId, Number(params.id));
  if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = teamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(teams)
    .set({ name: parsed.data.name })
    .where(eq(teams.id, team.id))
    .returning();

  return NextResponse.json({ team: updated });
}

// 팀을 지워도 소속 건물은 삭제되지 않는다 (buildings.teamId가 set null로
// 자동 해제되어 "미배정" 상태가 됨).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const team = await getOwnedTeam(session.userId, Number(params.id));
  if (!team) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(teams).where(eq(teams.id, team.id));
  return NextResponse.json({ ok: true });
}
