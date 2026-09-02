import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import { teamSchema } from "@/lib/validators";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      buildingCount: sql<number>`count(${buildings.id})::int`,
    })
    .from(teams)
    .leftJoin(buildings, eq(buildings.teamId, teams.id))
    .where(eq(teams.userId, session.userId))
    .groupBy(teams.id)
    .orderBy(teams.createdAt);

  return NextResponse.json({ teams: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = teamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [team] = await db
    .insert(teams)
    .values({ userId: session.userId, name: parsed.data.name })
    .returning();

  return NextResponse.json({ team }, { status: 201 });
}
