export type InspectionPlan = {
  inspectionType: "comprehensive" | "operational";
  scheduledDate: string; // YYYY-MM-DD
  status: "scheduled";
};

/**
 * 점검 주기 계산의 기준 날짜를 만든다. 실제 사용승인일이 있으면 그걸 쓰고,
 * (엑셀에 시트명만 "N월"로 돼 있어서) 반복 점검월만 아는 경우엔 그 달의 1일을
 * 기준으로 삼는다 - 계산 로직 자체가 연도/일자는 안 쓰고 월만 쓰므로 무방하다.
 * 둘 다 모르는 경우(예: 일괄 등록 시 사용승인일 정보가 없는 행)엔 null을
 * 반환한다 - 이런 건물은 일단 등록만 되고, 나중에 정부 데이터로 사용승인일을
 * 채운 뒤에 점검 일정이 만들어진다.
 */
export function getApprovalBasisDate(
  building: {
    useApprovalDate?: string | null;
    recurringInspectionMonth?: number | null;
  },
  today: Date = new Date()
): Date | null {
  if (building.useApprovalDate) {
    const [y, m, d] = building.useApprovalDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  if (building.recurringInspectionMonth) {
    return new Date(today.getFullYear(), building.recurringInspectionMonth - 1, 1);
  }
  return null;
}

/**
 * 소방시설 자체점검 일정 산정 (단순화 버전)
 *
 * 실제 법령(화재예방법 시행규칙 별표3)은 소방안전관리대상물 등급
 * (특급/1급/2급/3급), 스프링클러 설치 여부 등에 따라 점검 횟수·주기가
 * 달라진다. 여기서는 가장 일반적인 케이스(종합점검 연 1회 + 작동점검 연 1회)를
 * 기준으로 다음 점검일을 계산한다. 등급별 세부 규칙은 buildings.fireSafetyGrade
 * 값을 참고해 이 함수를 확장하면 된다.
 *
 * 사용승인월이 이미 지났어도 다음 해로 미루지 않는다 - 예를 들어 오늘이 9월인데
 * 사용승인월이 3월이면, 종합점검은 "올해 3월"로 잡고 작동점검은 그로부터 6개월
 * 뒤인 "올해 9월"로 잡는다. 다음 해로 미루면 점검이 조용히 1년 뒤로 숨어버리고,
 * 그 뒤를 잇는 작동점검도 같이 밀려서 이번 달 배치 목록에 아예 나타나지 않게
 * 되는 문제가 있었다. 지연 여부는 별도 상태로 구분하지 않는다 - 날짜가 지났어도
 * 완료 처리 전까지는 그냥 "예정"이다.
 */
export function calculateUpcomingInspections(
  useApprovalDate: Date,
  today: Date = new Date()
): InspectionPlan[] {
  const approvalMonth = useApprovalDate.getMonth();
  const approvalDay = Math.min(useApprovalDate.getDate(), 28);
  const comprehensive = new Date(today.getFullYear(), approvalMonth, approvalDay);
  return buildCyclePlans(comprehensive);
}

/**
 * 다음 해 점검 사이클(종합점검+작동점검) 산정.
 * 이번 사이클(종합+작동)이 둘 다 완료 처리됐을 때 호출된다 - 완료된 종합점검의
 * 실제 연도를 기준으로 +1년을 잡아야, 한참 늦게 완료한 경우에도 다음 사이클이
 * 엉뚱한 연도로 밀리지 않는다.
 */
export function calculateNextCycle(
  useApprovalDate: Date,
  previousComprehensiveDate: Date
): InspectionPlan[] {
  const approvalMonth = useApprovalDate.getMonth();
  const approvalDay = Math.min(useApprovalDate.getDate(), 28);
  const nextYear = previousComprehensiveDate.getFullYear() + 1;
  const comprehensive = new Date(nextYear, approvalMonth, approvalDay);
  return buildCyclePlans(comprehensive);
}

function buildCyclePlans(comprehensive: Date): InspectionPlan[] {
  const operational = new Date(comprehensive);
  operational.setMonth(operational.getMonth() + 6);

  return [
    { inspectionType: "comprehensive", scheduledDate: toDateString(comprehensive), status: "scheduled" },
    { inspectionType: "operational", scheduledDate: toDateString(operational), status: "scheduled" },
  ];
}

function toDateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
