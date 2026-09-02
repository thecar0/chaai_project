import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { buildingSchema } from "@/lib/validators";
import { maybeGenerateInitialSchedule } from "@/lib/create-building";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const building = await getOwnedBuilding(session.userId, Number(params.id));
  if (!building) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const parsed = buildingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const [updated] = await db
    .update(buildings)
    .set({
      name: data.name,
      address: data.address,
      buildingType: data.buildingType,
      totalFloorAreaM2: data.totalFloorAreaM2,
      floorCount: data.floorCount,
      useApprovalDate: data.useApprovalDate,
      recurringInspectionMonth: data.recurringInspectionMonth,
      fireSafetyGrade: data.fireSafetyGrade,
      notes: data.notes,
      hasSprinkler: data.hasSprinkler,
      hasWaterSpray: data.hasWaterSpray,
      hasSmokeControl: data.hasSmokeControl,
      isMultiUseBusiness: data.isMultiUseBusiness,
      isApartment: data.isApartment,
      unitCount: data.unitCount,
      isPerformanceDesign: data.isPerformanceDesign,
    })
    .where(eq(buildings.id, building.id))
    .returning();

  // 사용승인일/반복 점검월이 없어서 점검 일정 없이 등록됐던 건물이 이번 수정으로
  // 그 정보가 채워졌으면 최초 일정을 만들어준다 (이미 일정이 있으면 안 건드림).
  await maybeGenerateInitialSchedule(updated.id);

  return NextResponse.json({ building: updated });
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
