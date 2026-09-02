import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다"),
  name: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// 길이 제한은 db/schema.ts의 varchar 컬럼 길이와 맞춰뒀다 - 일괄 등록(bulk insert)
// 시 DB 에러로 뒤늦게 실패하는 대신 여기서 미리 걸러내기 위함.
//
// 주소/연면적/사용승인일은 전부 optional이다 - 일괄 등록에서 이 정보가 없는 행도
// 일단 등록되고, 나중에 "주소 채우기" · "연면적 채우기" · 건축물대장 대조에서
// 정부 데이터로 채워 넣을 수 있다 (사용승인일도 없으면 그때까지 점검 일정은
// 만들어지지 않는다 - create-building.ts 참고).
export const buildingSchema = z.object({
  name: z.string().min(1, "건축물명을 입력하세요").max(255, "건축물명이 너무 깁니다(255자 이내)"),
  // 주소를 모르는 행(예: 이름만 있는 엑셀 행)도 일단 등록하고, 나중에 "주소 채우기"에서
  // 건축물명으로 검색해 채운다.
  address: z
    .string()
    .min(1, "주소를 입력하세요")
    .max(500, "주소가 너무 깁니다(500자 이내)")
    .optional(),
  buildingType: z.string().min(1, "주용도를 입력하세요").max(100, "주용도가 너무 깁니다(100자 이내)"),
  totalFloorAreaM2: z
    .number()
    .int("연면적은 정수로 입력하세요")
    .positive("연면적은 0보다 큰 숫자여야 합니다")
    .optional(),
  floorCount: z
    .number()
    .int("층수는 정수로 입력하세요")
    .positive("층수는 0보다 큰 숫자여야 합니다")
    .optional(),
  // 실제 사용승인일을 아는 경우. 모르고 "매년 반복되는 점검월"만 아는 경우엔
  // 대신 recurringInspectionMonth를 쓴다. 둘 다 없어도 등록은 된다(점검 일정만
  // 나중으로 미뤄짐).
  useApprovalDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "사용승인일이 올바르지 않습니다" })
    .optional(),
  recurringInspectionMonth: z
    .number()
    .int("반복 점검월은 1~12 사이의 정수여야 합니다")
    .min(1, "반복 점검월은 1~12 사이여야 합니다")
    .max(12, "반복 점검월은 1~12 사이여야 합니다")
    .optional(),
  fireSafetyGrade: z.string().max(50, "소방안전등급이 너무 깁니다(50자 이내)").optional(),
  notes: z.string().optional(),

  // 점검인력 배치 계산용 (전부 optional - 모르면 "정보 없음"으로 취급)
  hasSprinkler: z.boolean().optional(),
  hasWaterSpray: z.boolean().optional(),
  hasSmokeControl: z.boolean().optional(),
  isMultiUseBusiness: z.boolean().optional(),
  isApartment: z.boolean().optional(),
  unitCount: z
    .number()
    .int("세대수는 정수로 입력하세요")
    .positive("세대수는 0보다 큰 숫자여야 합니다")
    .optional(),
  isPerformanceDesign: z.boolean().optional(),
});

export const inspectionUpdateSchema = z.object({
  status: z.enum(["scheduled", "completed", "canceled"]).optional(),
  scheduledDate: z.string().optional(),
  isManuallyScheduled: z.boolean().optional(),
  notes: z.string().optional(),
});
