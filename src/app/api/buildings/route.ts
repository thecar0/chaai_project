import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { buildingSchema } from "@/lib/validators";
import { createBuildingWithSchedule } from "@/lib/create-building";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.query.buildings.findMany({
    where: eq(buildings.userId, session.userId),
    orderBy: (b, { desc }) => [desc(b.createdAt)],
  });

  return NextResponse.json({ buildings: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = buildingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const building = await createBuildingWithSchedule(session.userId, parsed.data);

  return NextResponse.json({ building }, { status: 201 });
}
