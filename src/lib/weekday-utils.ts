// 서버(배치 엔진)와 클라이언트(캘린더 화면)가 똑같이 써야 하는 순수 날짜 계산 -
// 주말 제외 로직이 서버·클라이언트에서 서로 다르면 "이 점검이 며칠에 걸쳐
// 있는지" 계산이 어긋난다. 외부 의존성이 없어(DB 등) 클라이언트 컴포넌트에서도
// 그대로 import할 수 있다.

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// 주말이면 다음 평일로 넘긴다 (시작일 보정용).
export function toWeekday(d: Date): Date {
  const copy = new Date(d);
  while (isWeekend(copy)) copy.setDate(copy.getDate() + 1);
  return copy;
}

// 하루 전진하되, 그 결과가 주말이면 다음 평일까지 계속 넘긴다.
export function nextWeekday(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + 1);
  return toWeekday(copy);
}

// start(평일이라고 가정)로부터 평일 기준으로 steps번 전진한 날짜.
export function weekdayAfterSteps(start: Date, steps: number): Date {
  let d = new Date(start);
  for (let i = 0; i < steps; i++) d = nextWeekday(d);
  return d;
}

// start(평일)부터 시작해서 평일만 count개 나열한다 - 여러 날에 걸친 점검이
// 실제로 어느 날짜들을 차지하는지 계산할 때 쓴다.
export function weekdayRange(start: Date, count: number): Date[] {
  const dates: Date[] = [];
  let d = toWeekday(new Date(start));
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d = nextWeekday(d);
  }
  return dates;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
