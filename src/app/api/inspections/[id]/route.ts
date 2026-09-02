import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import { getSession } from "@/lib/session";
import { inspectionUpdateSchema } from "@/lib/validators";
import { maybeGenerateNextCycle, maybeRevokeNextCycle } from "@/lib/inspection-cycle";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = inspectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const inspectionId = Number(params.id);
  const owned = await db
    .select({ id: inspectionSchedules.id })
    .from(inspectionSchedules)
    .innerJoin(buildings, eq(inspectionSchedules.buildingId, buildings.id))
    .where(eq(buildings.userId, session.userId));

  if (!owned.some((o) => o.id === inspectionId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updates = parsed.data;
  const setValues: Partial<typeof inspectionSchedules.$inferInsert> = { ...updates };
  if (updates.status === "completed") {
    setValues.completedAt = new Date();
  } else if (updates.status) {
    // 완료 취소 등 - 완료가 아닌 상태로 바뀌면 완료 시각도 같이 지운다.
    setValues.completedAt = null;
  }
  // 날짜만 옮기고 상태를 명시하지 않은 경우(이월) - 지연이라는 상태는 없으므로 그냥 예정으로 둔다.
  if (updates.scheduledDate && !updates.status) {
    setValues.status = "scheduled";
  }

  const [updated] = await db
    .update(inspectionSchedules)
    .set(setValues)
    .where(eq(inspectionSchedules.id, inspectionId))
    .returning();

  if (updates.status === "completed") {
    await maybeGenerateNextCycle(updated.buildingId);
  } else if (updates.status) {
    await maybeRevokeNextCycle(updated.buildingId);
  }

  return NextResponse.json({ inspection: updated });
}
