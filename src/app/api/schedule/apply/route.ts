import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings, inspectionSchedules, teams } from "@/db/schema";
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
  // 미리보기 때 거리 기준으로 자동 배정됐던 미배정 건물들 - 적용 시점에 실제로
  // buildings.teamId를 채워서 이후에는 "고정 담당"으로 취급되게 한다(매달 다른
  // 팀으로 왔다갔다 하지 않도록).
  teamAssignments: z
    .array(z.object({ buildingId: z.number().int().positive(), teamId: z.number().int().positive() }))
    .optional(),
  // 혼자서도 하루 한도를 넘어 여러 날에 걸쳐 배치된 점검의 소요일수 - days에는
  // 시작일에만 한 번 나오므로, 여기서 durationDays를 같이 저장해야 캘린더가
  // 마지막 날까지 표시할 수 있다. 없는(1일짜리) 점검은 안 보내도 된다.
  durations: z
    .array(z.object({ inspectionId: z.number().int().positive(), durationDays: z.number().int().min(1) }))
    .optional(),
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

  // durationDays도 매번 다시 써준다(1일로 재배치됐으면 이전에 남아있던 여러 날짜
  // 값을 지워야 하므로) - 언급 안 된 id는 1일로 취급한다.
  const durationByInspectionId = new Map(
    (parsed.data.durations ?? []).map((d) => [d.inspectionId, d.durationDays])
  );
  const idsByDuration = new Map<number, number[]>();
  for (const id of allIds) {
    if (!ownedIds.has(id)) continue;
    const duration = durationByInspectionId.get(id) ?? 1;
    const list = idsByDuration.get(duration) ?? [];
    list.push(id);
    idsByDuration.set(duration, list);
  }
  await Promise.all(
    Array.from(idsByDuration.entries()).map(([durationDays, ids]) =>
      db.update(inspectionSchedules).set({ durationDays }).where(inArray(inspectionSchedules.id, ids))
    )
  );

  if (parsed.data.teamAssignments && parsed.data.teamAssignments.length > 0) {
    const teamIds = [...new Set(parsed.data.teamAssignments.map((a) => a.teamId))];
    const ownedTeams = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.userId, session.userId), inArray(teams.id, teamIds)));
    const ownedTeamIds = new Set(ownedTeams.map((t) => t.id));

    const byTeam = new Map<number, number[]>();
    for (const a of parsed.data.teamAssignments) {
      if (!ownedTeamIds.has(a.teamId)) continue;
      const list = byTeam.get(a.teamId) ?? [];
      list.push(a.buildingId);
      byTeam.set(a.teamId, list);
    }

    // teamAssignedAuto: true로 표시해서, 다음 배치 때 그 팀이 넘치면 이 건물이
    // 다른 팀으로 다시 옮겨질 수 있는 "느슨한" 배정으로 남게 한다(사용자가 직접
    // 지정한 건물과 구분).
    await Promise.all(
      Array.from(byTeam.entries()).map(([teamId, buildingIds]) =>
        db
          .update(buildings)
          .set({ teamId, teamAssignedAuto: true })
          .where(and(eq(buildings.userId, session.userId), inArray(buildings.id, buildingIds)))
      )
    );
  }

  return NextResponse.json({ applied: true });
}
