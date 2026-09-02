import type { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, inspectionSchedules } from "@/db/schema";
import { calculateUpcomingInspections, getApprovalBasisDate } from "./inspection-rules";
import type { buildingSchema } from "./validators";

type BuildingInput = z.infer<typeof buildingSchema>;

// 사용승인일/반복 점검월이 없어서 점검 일정 없이 등록됐던 건물이, 나중에 수정
// 화면에서 그 정보가 채워지면 최초 일정을 만들어준다. 이미 일정이 하나라도
// 있으면(과거에 생성됐거나 완료 사이클이 있었거나) 건드리지 않는다.
export async function maybeGenerateInitialSchedule(buildingId: number) {
  const existing = await db
    .select({ id: inspectionSchedules.id })
    .from(inspectionSchedules)
    .where(eq(inspectionSchedules.buildingId, buildingId))
    .limit(1);
  if (existing.length > 0) return null;

  const [building] = await db.select().from(buildings).where(eq(buildings.id, buildingId));
  if (!building) return null;

  const basisDate = getApprovalBasisDate(building);
  if (!basisDate) return null;

  const plans = calculateUpcomingInspections(basisDate);
  if (plans.length === 0) return null;

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

export async function createBuildingWithSchedule(userId: number, data: BuildingInput) {
  const [building] = await db
    .insert(buildings)
    .values({
      userId,
      teamId: data.teamId,
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
    .returning();

  // 건축물 등록과 동시에 소방점검 일정을 자동 생성. 사용승인일/반복 점검월을
  // 아직 모르면(예: 일괄 등록 시 정보 없음) 일정 생성은 건너뛰고, 나중에
  // 정부 데이터로 사용승인일을 채운 뒤 다시 시도한다.
  const basisDate = getApprovalBasisDate(data);
  const plans = basisDate ? calculateUpcomingInspections(basisDate) : [];
  if (plans.length > 0) {
    await db.insert(inspectionSchedules).values(
      plans.map((p) => ({
        buildingId: building.id,
        inspectionType: p.inspectionType,
        scheduledDate: p.scheduledDate,
        status: p.status,
      }))
    );
  }

  return building;
}

// 대량 업로드(엑셀 일괄 등록)용: 행마다 순차적으로 DB를 왕복하면 수백~수천 행에서
// 매우 느려지므로(쿼리 2번 × N행), 여러 행을 한 번의 INSERT로 묶어서 처리한다.
// 청크 하나가 통째로 실패하면 그 청크에 포함된 행 전체를 실패로 보고한다
// (validators.ts에서 DB 컬럼 길이에 맞춰 미리 검증하므로 이 경로에서 실패할 일은 드물다).
const BATCH_CHUNK_SIZE = 200;

export type BatchBuildingItem = {
  data: BuildingInput;
  rowNumber: number;
  sheetName: string;
};

export type BatchResult = {
  sheetName: string;
  rowNumber: number;
  success: boolean;
  name: string;
  error?: string;
};

export async function createBuildingsBatch(
  userId: number,
  items: BatchBuildingItem[]
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (let i = 0; i < items.length; i += BATCH_CHUNK_SIZE) {
    const chunk = items.slice(i, i + BATCH_CHUNK_SIZE);

    try {
      const insertedBuildings = await db
        .insert(buildings)
        .values(
          chunk.map((item) => ({
            userId,
            teamId: item.data.teamId,
            name: item.data.name,
            address: item.data.address,
            buildingType: item.data.buildingType,
            totalFloorAreaM2: item.data.totalFloorAreaM2,
            floorCount: item.data.floorCount,
            useApprovalDate: item.data.useApprovalDate,
            recurringInspectionMonth: item.data.recurringInspectionMonth,
            fireSafetyGrade: item.data.fireSafetyGrade,
            notes: item.data.notes,
            hasSprinkler: item.data.hasSprinkler,
            hasWaterSpray: item.data.hasWaterSpray,
            hasSmokeControl: item.data.hasSmokeControl,
            isMultiUseBusiness: item.data.isMultiUseBusiness,
            isApartment: item.data.isApartment,
            unitCount: item.data.unitCount,
            isPerformanceDesign: item.data.isPerformanceDesign,
          }))
        )
        .returning();

      const scheduleRows = insertedBuildings.flatMap((building) => {
        const basisDate = getApprovalBasisDate(building);
        if (!basisDate) return [];
        return calculateUpcomingInspections(basisDate).map((p) => ({
          buildingId: building.id,
          inspectionType: p.inspectionType,
          scheduledDate: p.scheduledDate,
          status: p.status,
        }));
      });
      if (scheduleRows.length > 0) {
        await db.insert(inspectionSchedules).values(scheduleRows);
      }

      for (const item of chunk) {
        results.push({
          sheetName: item.sheetName,
          rowNumber: item.rowNumber,
          success: true,
          name: item.data.name,
        });
      }
    } catch {
      for (const item of chunk) {
        results.push({
          sheetName: item.sheetName,
          rowNumber: item.rowNumber,
          success: false,
          name: item.data.name,
          error: "일괄 저장 중 오류가 발생했습니다.",
        });
      }
    }
  }

  return results;
}
