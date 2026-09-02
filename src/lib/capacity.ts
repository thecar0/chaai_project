// 소방시설 자체점검 점검인력 배치기준 계산 엔진.
// 사용자가 제공한 기준만을 근거로 계산하며, 기준에 없는 수치나 조건은 임의로 추가하지 않는다.

export type InspectionCategory = "comprehensive" | "operational" | "apartment";

export class CapacityRuleError extends Error {}

// ── 규칙 3: 점검인력 구성별 점검한도 (1일 기준) ──
// 기술인력 3명이 기본 1단위, 1명 추가 시 가산분만큼 선형 증가 (표의 각 행이
// 정확히 이 가산분 간격이므로 표를 그대로 공식화한다).
const BASE_PERSONNEL = 3;
const BASE_LIMIT: Record<InspectionCategory, number> = {
  comprehensive: 8000,
  operational: 10000,
  apartment: 250,
};
const PER_PERSON_INCREMENT: Record<InspectionCategory, number> = {
  comprehensive: 2000,
  operational: 2500,
  apartment: 60,
};

export function getDailyLimit(personnelCount: number, category: InspectionCategory): number {
  if (!Number.isInteger(personnelCount) || personnelCount < BASE_PERSONNEL) {
    throw new CapacityRuleError(
      `기술인력은 최소 ${BASE_PERSONNEL}명부터 기준이 정의되어 있습니다 (입력: ${personnelCount}명). 별도 확인 필요.`
    );
  }
  return (
    BASE_LIMIT[category] + (personnelCount - BASE_PERSONNEL) * PER_PERSON_INCREMENT[category]
  );
}

// ── 규칙 1: 점검면적 = 전체면적 × 가감계수 × 설비계수 ──
// 설비 유무가 null(정보 없음)이면 "없다고 확정되지 않은 것"으로 보고 감액하지 않는다.
export function calculateInspectionArea(input: {
  totalAreaM2: number;
  hasSprinkler: boolean | null | undefined;
  hasWaterSpray: boolean | null | undefined;
  hasSmokeControl: boolean | null | undefined;
  isOperational: boolean;
  isMultiUseBusiness: boolean | null | undefined;
}): number {
  const allThreeConfirmedAbsent =
    input.hasSprinkler === false &&
    input.hasWaterSpray === false &&
    input.hasSmokeControl === false;
  const equipmentFactor = allThreeConfirmedAbsent ? 0.7 : 1;

  const multiUseFactor =
    input.isOperational && input.isMultiUseBusiness === true ? 0.8 : 1;

  return input.totalAreaM2 * equipmentFactor * multiUseFactor;
}

// ── 규칙 2: 아파트 세대수 (가감계수 미적용) ──
export function calculateApartmentEffectiveUnits(input: {
  unitCount: number;
  hasSprinkler: boolean | null | undefined;
  hasWaterSpray: boolean | null | undefined;
  hasSmokeControl: boolean | null | undefined;
}): number {
  let deduction = 0;
  if (input.hasSprinkler === false) deduction += 0.1;
  if (input.hasWaterSpray === false) deduction += 0.1;
  if (input.hasSmokeControl === false) deduction += 0.1;
  return input.unitCount * (1 - deduction);
}

// ── 확정된 거리 감액 공식 ──
// 감액분 = 점검한도 × 0.02 × floor(거리km ÷ 5), 최종한도 = 점검한도 − 감액분
export function applyDistanceDegradation(limit: number, distanceKm: number): number {
  const segments = Math.floor(distanceKm / 5);
  const reduced = limit * (1 - 0.02 * segments);
  return Math.max(0, reduced);
}

// ── 규칙 4: 점검일수 = 점검면적(세대수) ÷ 점검한도, 올림 ──
export function calculateInspectionDays(effectiveSize: number, dailyLimit: number): number {
  if (dailyLimit <= 0) {
    throw new CapacityRuleError("점검한도가 0 이하입니다. 별도 확인 필요.");
  }
  return Math.ceil(effectiveSize / dailyLimit);
}

// ── 규칙 5/6: 참고용 인력 구성 기준 (계산에는 쓰이지 않음, 정보 표시용) ──
export type PersonnelCompositionRule = {
  scope: string;
  main: string;
  assistant: string;
};

export const SCALE_BASED_COMPOSITION: {
  special: PersonnelCompositionRule; // 50층 이상 / 성능위주설계 대상
  general: PersonnelCompositionRule;
} = {
  special: {
    scope: "50층 이상 / 성능위주설계 대상",
    main: "관리사 5년 이상 1명",
    assistant: "고급 2명, 중급 2명, 초급 2명",
  },
  general: {
    scope: "일반 대상",
    main: "관리사 1년 이상 1명",
    assistant: "중급 1명, 초급 1명",
  },
};

export const REGISTRATION_COMPOSITION: {
  professional: PersonnelCompositionRule & { businessScope: string };
  general: PersonnelCompositionRule & { businessScope: string };
} = {
  professional: {
    scope: "전문 점검업 등록",
    main: "관리사 5년 이상 1명 + 3년 이상 1명",
    assistant: "고급 2명, 중급 2명, 초급 2명",
    businessScope: "특급·1급·2급·3급 전체",
  },
  general: {
    scope: "일반 점검업 등록",
    main: "관리사 1년 이상 1명",
    assistant: "중급 1명, 초급 1명",
    businessScope: "1급·2급·3급",
  },
};

// floorCount와 성능위주설계 여부로 규칙 5의 규모 구분을 판정한다.
export function getScaleBasedComposition(input: {
  floorCount: number | null | undefined;
  isPerformanceDesign: boolean | null | undefined;
}): PersonnelCompositionRule {
  const isSpecialScale = (input.floorCount ?? 0) >= 50 || input.isPerformanceDesign === true;
  return isSpecialScale ? SCALE_BASED_COMPOSITION.special : SCALE_BASED_COMPOSITION.general;
}
