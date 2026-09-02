// DB의 inspection_status enum과 그대로 맞춘 타입 (overdue 값도 스키마상 여전히
// 허용되지만, 애플리케이션 코드에서는 더 이상 만들어내지 않는다 - 아래 DisplayStatus
// 참고).
export type InspectionType = "comprehensive" | "operational";
export type InspectionStatus = "scheduled" | "completed" | "overdue" | "canceled";

export const TYPE_LABEL: Record<InspectionType, string> = {
  comprehensive: "종합점검",
  operational: "작동점검",
};

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  scheduled: "예정",
  completed: "완료",
  overdue: "예정",
  canceled: "취소",
};

// 표시용 뱃지/텍스트 색상 (블랙·화이트 기조 + 포인트 컬러(하늘색)와 의미 전달이 필요한 상태만 색상 사용)
export const STATUS_BADGE_CLASS: Record<InspectionStatus, string> = {
  scheduled: "bg-accent-50 text-accent-600",
  completed: "bg-[#e8f8ec] text-[#1d7a34]",
  overdue: "bg-accent-50 text-accent-600",
  canceled: "bg-silver-100 text-silver-500 line-through",
};

// 캘린더 셀의 점(dot) 색상
export const STATUS_DOT_CLASS: Record<InspectionStatus, string> = {
  scheduled: "bg-accent-500",
  completed: "bg-[#34c759]",
  overdue: "bg-accent-500",
  canceled: "bg-silver-400",
};

// 사용자에게 보여줄 3단계 상태: 예정 / 이월(수동으로 날짜를 옮긴 건) / 완료.
// "지연"은 별도 상태로 두지 않는다 - 날짜가 지났어도 완료 처리 전까지는 그냥 예정이다.
export type DisplayStatus = "scheduled" | "postponed" | "completed";

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  scheduled: "예정",
  postponed: "이월",
  completed: "완료",
};

export const DISPLAY_STATUS_BADGE_CLASS: Record<DisplayStatus, string> = {
  scheduled: "bg-accent-50 text-accent-600",
  postponed: "bg-[#fff4e5] text-[#b25e00]",
  completed: "bg-[#e8f8ec] text-[#1d7a34]",
};

export const DISPLAY_STATUS_DOT_CLASS: Record<DisplayStatus, string> = {
  scheduled: "bg-accent-500",
  postponed: "bg-[#ff9500]",
  completed: "bg-[#34c759]",
};

export function getDisplayStatus(
  status: InspectionStatus,
  isManuallyScheduled: boolean
): DisplayStatus {
  if (status === "completed") return "completed";
  if (isManuallyScheduled) return "postponed";
  return "scheduled";
}

// 사용승인일은 목록/상세 화면에서는 년/월까지만 보여준다 (정확한 일자는 점검 주기
// 계산에만 쓰이고, 사용자가 볼 때는 년/월이면 충분함).
export function formatYearMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return `${y}년 ${Number(m)}월`;
}

// 사용승인일이 있으면 "YYYY년 M월", 없고 반복 점검월만 있으면 "매년 M월 반복",
// 둘 다 없으면 "-".
export function formatApprovalBasis(building: {
  useApprovalDate: string | null;
  recurringInspectionMonth: number | null;
}): string {
  if (building.useApprovalDate) return formatYearMonth(building.useApprovalDate);
  if (building.recurringInspectionMonth) return `매년 ${building.recurringInspectionMonth}월 반복`;
  return "-";
}

// 건축물 전체 리스트용 - 사용승인일이든 반복 점검월이든 구분 없이 월만 보여준다
// ("YYYY년" · "매년 ... 반복" 같은 부가 설명 없이).
export function formatMonthOnly(building: {
  useApprovalDate: string | null;
  recurringInspectionMonth: number | null;
}): string {
  if (building.useApprovalDate) {
    return `${Number(building.useApprovalDate.split("-")[1])}월`;
  }
  if (building.recurringInspectionMonth) return `${building.recurringInspectionMonth}월`;
  return "-";
}
