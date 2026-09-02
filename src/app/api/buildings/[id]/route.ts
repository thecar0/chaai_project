import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";

async function getOwnedBuilding(userId: number, id: number) {
  return db.query.buildings.findFirst({
    where: and(eq(buildings.id, id), eq(buildings.userId, userId)),
    with: { inspections: true },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const building = await getOwnedBuilding(session.userId, Number(params.id));
  if (!building) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ building });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const building = await getOwnedBuilding(session.userId, Number(params.id));
  if (!building) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(buildings).where(eq(buildings.id, building.id));
  return NextResponse.json({ ok: true });
}
