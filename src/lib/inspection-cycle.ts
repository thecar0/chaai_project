import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import { calculateNextCycle, getApprovalBasisDate } from "./inspection-rules";

function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 한 건물의 종합점검+작동점검이 둘 다 완료 처리됐으면 다음 해 사이클을 새로 만든다.
 * 이미 다음 사이클이 만들어져 있으면(가장 최근 종합/작동점검이 완료 상태가 아니면)
 * 아무것도 하지 않는다 - 그래서 완료 처리 때마다 호출해도 중복 생성되지 않는다.
 */
export async function maybeGenerateNextCycle(buildingId: number) {
  const [building] = await db
    .select({
      useApprovalDate: buildings.useApprovalDate,
      recurringInspectionMonth: buildings.recurringInspectionMonth,
    })
    .from(buildings)
    .where(eq(buildings.id, buildingId));
  if (!building) return null;

  const [latestComprehensive] = await db
    .select()
    .from(inspectionSchedules)
    .where(
      and(
        eq(inspectionSchedules.buildingId, buildingId),
        eq(inspectionSchedules.inspectionType, "comprehensive")
      )
    )
    .orderBy(desc(inspectionSchedules.scheduledDate))
    .limit(1);

  const [latestOperational] = await db
    .select()
    .from(inspectionSchedules)
    .where(
      and(
        eq(inspectionSchedules.buildingId, buildingId),
        eq(inspectionSchedules.inspectionType, "operational")
      )
    )
    .orderBy(desc(inspectionSchedules.scheduledDate))
    .limit(1);

  if (
    !latestComprehensive ||
    !latestOperational ||
    latestComprehensive.status !== "completed" ||
    latestOperational.status !== "completed"
  ) {
    return null;
  }

  // 이 시점에 완료된 점검이 이미 있다는 건 애초에 사용승인일/반복월 기준으로
  // 일정이 만들어졌다는 뜻이므로 기준일이 없을 수 없다 - 그래도 타입 안전을 위해 확인.
  const basisDate = getApprovalBasisDate(building);
  if (!basisDate) return null;

  const plans = calculateNextCycle(basisDate, parseDateString(latestComprehensive.scheduledDate));

  return db
    .insert(inspectionSchedules)
    .values(
      plans.map((p) => ({
        buildingId,
        inspectionType: p.inspectionType,
        scheduledDate: p.scheduledDate,
        status: p.status,
      }))
    )
    .returning();
}

/**
 * 완료 취소로 인해 "이번 사이클 둘 다 완료" 조건이 깨졌을 때, maybeGenerateNextCycle이
 * 만들어뒀던 다음 해 사이클을 되돌린다. 다음 사이클을 사용자가 이미 손댔으면(이월,
 * 완료 등) 안전하게 그대로 둔다 - 자동 생성 직후의 손대지 않은 상태일 때만 지운다.
 */
export async function maybeRevokeNextCycle(buildingId: number) {
  const comprehensiveRows = await db
    .select()
    .from(inspectionSchedules)
    .where(
      and(
        eq(inspectionSchedules.buildingId, buildingId),
        eq(inspectionSchedules.inspectionType, "comprehensive")
      )
    )
    .orderBy(desc(inspectionSchedules.scheduledDate))
    .limit(2);

  const operationalRows = await db
    .select()
    .from(inspectionSchedules)
    .where(
      and(
        eq(inspectionSchedules.buildingId, buildingId),
        eq(inspectionSchedules.inspectionType, "operational")
      )
    )
    .orderBy(desc(inspectionSchedules.scheduledDate))
    .limit(2);

  if (comprehensiveRows.length < 2 || operationalRows.length < 2) return null;

  const [nextComprehensive, prevComprehensive] = comprehensiveRows;
  const [nextOperational, prevOperational] = operationalRows;

  const prevBothCompleted =
    prevComprehensive.status === "completed" && prevOperational.status === "completed";
  if (prevBothCompleted) return null;

  const isPristine = (row: typeof nextComprehensive) =>
    row.status === "scheduled" && !row.isManuallyScheduled && !row.completedAt;

  if (!isPristine(nextComprehensive) || !isPristine(nextOperational)) return null;

  await db
    .delete(inspectionSchedules)
    .where(eq(inspectionSchedules.id, nextComprehensive.id));
  await db
    .delete(inspectionSchedules)
    .where(eq(inspectionSchedules.id, nextOperational.id));

  return { removed: [nextComprehensive.id, nextOperational.id] };
}
