import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import { getSession } from "@/lib/session";

// "미리보기"에서 이미 계산해둔 날짜별 배치 결과를 그대로 저장만 한다. 여기서
// 재계산(DB 조회, 지오코딩, 실주행거리 API 호출)을 하지 않기 때문에 미리보기
// 대비 훨씬 빠르다 - 예전엔 적용을 누를 때마다 배치 전체를 처음부터 다시
// 계산해서(거리 API 재호출 포함) 느렸다.
const applySchema = z.object({
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        inspectionIds: z.array(z.number().int().positive()),
      })
    )
    .min(1, "적용할 배치 결과가 없습니다"),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // 클라이언트가 보낸 id들이 실제로 본인 소유 점검인지 확인 (방어적 - 다른 사용자
  // id를 섞어 보내도 무시됨).
  const allIds = parsed.data.days.flatMap((d) => d.inspectionIds);
  const owned = await db
    .select({ id: inspectionSchedules.id })
    .from(inspectionSchedules)
    .innerJoin(buildings, eq(inspectionSchedules.buildingId, buildings.id))
    .where(and(eq(buildings.userId, session.userId), inArray(inspectionSchedules.id, allIds)));
  const ownedIds = new Set(owned.map((o) => o.id));

  await Promise.all(
    parsed.data.days.map((day) => {
      const ids = day.inspectionIds.filter((id) => ownedIds.has(id));
      if (ids.length === 0) return Promise.resolve();
      return db
        .update(inspectionSchedules)
        .set({ scheduledDate: day.date })
        .where(inArray(inspectionSchedules.id, ids));
    })
  );

  return NextResponse.json({ applied: true });
}
