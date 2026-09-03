import { TYPE_LABEL, type InspectionType } from "@/lib/inspection-format";

export type Category = "comprehensive" | "operational" | "apartment";

export type MergedItem = {
  buildingId: number;
  inspectionId: number;
  name: string;
  inspectionType: InspectionType;
  rawAmount: number;
  usageRatio: number;
  category: Category;
};

export type MergedGroup = {
  category: Category;
  label: string;
  dailyLimit: number;
  items: MergedItem[];
};

export type MergedDay = {
  date: string;
  usedRatio: number;
  estimatedMinutes: number;
  groups: MergedGroup[];
};

export function unitFor(category: Category) {
  return category === "apartment" ? "세대" : "㎡";
}

export function formatMinutes(minutes: number) {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// 날짜별 배치 결과를 카드 목록으로 보여준다 - 팀 하나만 배치할 때(ScheduleRunForm)와
// 여러 팀을 한 번에 배치할 때(TeamDistributeForm)가 동일하게 쓴다.
export default function PlacementDayList({ days }: { days: MergedDay[] }) {
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => (
        <div
          key={day.date}
          className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-silver-200 px-5 py-2.5 text-[13px]">
            <span className="font-medium">{day.date}</span>
            <span className="flex items-center gap-2 text-[11px] text-silver-500">
              <span>오늘 인력 능력 {Math.round(day.usedRatio * 100)}% 사용</span>
              <span
                className="text-silver-400"
                title="법정 한도(면적·세대수)와는 별개로, 통상 근무시간(점심 제외 7시간) 기준 참고 소요시간입니다. 법적 기준이 아니며 실제 소요시간은 건물 구조·설비·이동시간에 따라 달라질 수 있습니다."
              >
                · 참고 소요시간 {formatMinutes(day.estimatedMinutes)}
              </span>
            </span>
          </div>
          {day.groups.map((group) => {
            const used = group.items.reduce((sum, i) => sum + i.rawAmount, 0);
            // 아파트는 같은 목록 안에 종합/작동점검이 섞여 있으므로 유형별로 나눠서 보여준다.
            const comprehensiveItems =
              group.category === "apartment"
                ? group.items.filter((i) => i.inspectionType === "comprehensive")
                : [];
            const operationalItems =
              group.category === "apartment"
                ? group.items.filter((i) => i.inspectionType === "operational")
                : [];

            return (
              <div key={group.category} className="border-b border-silver-100 last:border-0">
                <div className="flex items-center justify-between bg-silver-50 px-5 py-1.5 text-[12px] text-silver-500">
                  <span>{group.label}</span>
                  <span>
                    {Math.round(used).toLocaleString()} / {group.dailyLimit.toLocaleString()}
                    {unitFor(group.category)} 사용
                  </span>
                </div>
                {group.category === "apartment" ? (
                  <>
                    {(
                      [
                        ["comprehensive", comprehensiveItems],
                        ["operational", operationalItems],
                      ] as const
                    ).map(
                      ([type, items]) =>
                        items.length > 0 && (
                          <div key={type}>
                            <div className="bg-silver-50/60 px-5 py-1 text-[11px] font-medium text-silver-400">
                              {TYPE_LABEL[type]} · {items.length}건
                            </div>
                            <ul>
                              {items.map((item) => (
                                <li
                                  key={item.inspectionId}
                                  className="flex items-center justify-between px-5 py-2 text-[13px]"
                                >
                                  <span>{item.name}</span>
                                  <span className="text-silver-500">
                                    {Math.round(item.rawAmount).toLocaleString()}
                                    {unitFor(item.category)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                    )}
                  </>
                ) : (
                  <ul>
                    {group.items.map((item) => (
                      <li
                        key={item.inspectionId}
                        className="flex items-center justify-between px-5 py-2 text-[13px]"
                      >
                        <span>{item.name}</span>
                        <span className="text-silver-500">
                          {Math.round(item.rawAmount).toLocaleString()}
                          {unitFor(item.category)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
