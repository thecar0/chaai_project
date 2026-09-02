"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TYPE_LABEL, type InspectionType } from "@/lib/inspection-format";

type Category = "comprehensive" | "operational" | "apartment";

const CATEGORY_LABEL: Record<Category, string> = {
  comprehensive: "종합점검",
  operational: "작동점검",
  apartment: "아파트",
};

type MergedItem = {
  buildingId: number;
  inspectionId: number;
  name: string;
  inspectionType: InspectionType;
  rawAmount: number;
  usageRatio: number;
  category: Category;
};

type MergedGroup = {
  category: Category;
  label: string;
  dailyLimit: number;
  items: MergedItem[];
};

type MergedDay = {
  date: string;
  usedRatio: number;
  estimatedMinutes: number;
  groups: MergedGroup[];
};

type RunResult = {
  days: MergedDay[];
  unplaced: {
    buildingId: number;
    inspectionId: number;
    name: string;
    reason: string;
    reasonCode: "capacity" | "invalid_amount";
    category: string;
  }[];
  warnings: string[];
  // 인원 부족으로 못 들어간 게 있을 때만 계산됨 - 이번 달 안에 전부 배치되는 최소
  // 인원수. 상한(200명)까지 찾아봐도 안 되면 null.
  recommendedPersonnelCount: number | null;
};

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function unitFor(category: Category) {
  return category === "apartment" ? "세대" : "㎡";
}

function formatMinutes(minutes: number) {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default function ScheduleRunForm({
  initialMonth,
  onApplied,
}: {
  initialMonth?: string;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth ?? currentMonthValue());
  const [personnelCount, setPersonnelCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  // result를 계산할 때 쓴 인원수를 따로 저장해둔다 - 결과가 떠 있는 동안 위쪽
  // 인원수 입력칸을 바꿔도(재계산 전) 실제 이 결과가 몇 명 기준인지 헷갈리지 않게.
  const [resultPersonnelCount, setResultPersonnelCount] = useState<number | null>(null);
  // 적용 후 초기 화면으로 돌아간 뒤에도 "방금 뭘 적용했는지" 확인할 수 있게 남겨둔다.
  const [lastApplied, setLastApplied] = useState<{
    month: string;
    personnelCount: number;
    dayCount: number;
  } | null>(null);

  // count를 생략하면 현재 입력값(personnelCount)을 쓴다 - "추천 인원으로 다시
  // 계산" 버튼처럼 state 반영을 기다리지 않고 바로 그 값으로 계산하고 싶을 때
  // 명시적으로 넘긴다.
  async function runPlacement(count?: number) {
    const effectiveCount = count ?? personnelCount;
    setError(null);
    setLoading(true);
    setLastApplied(null);

    const res = await fetch("/api/schedule/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, personnelCount: effectiveCount }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "배치 계산에 실패했습니다.");
      return;
    }
    setResult(data);
    setResultPersonnelCount(effectiveCount);
    setPersonnelCount(effectiveCount);
  }

  // 미리보기에서 이미 계산해둔 결과를 그대로 저장만 한다 - 배치를 처음부터
  // 다시 계산(거리 API 재호출 포함)하지 않으므로 훨씬 빠르다.
  async function applyResult() {
    if (!result || resultPersonnelCount == null) return;
    setError(null);
    setApplying(true);

    const res = await fetch("/api/schedule/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        days: result.days.map((day) => ({
          date: day.date,
          inspectionIds: day.groups.flatMap((group) => group.items.map((item) => item.inspectionId)),
        })),
      }),
    });
    const data = await res.json();
    setApplying(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "적용에 실패했습니다.");
      return;
    }
    // 적용되면 미리보기 결과는 지우고 초기 화면으로 돌아간다 - 대신 방금 적용한
    // 내용(인원수 등)은 아래에 짧게 남겨둔다.
    setLastApplied({ month, personnelCount: resultPersonnelCount, dayCount: result.days.length });
    setResult(null);
    setResultPersonnelCount(null);
    router.refresh();
    onApplied?.();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-silver-300/70 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
            대상 월
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
            기술인력 인원수
            <input
              type="number"
              min={3}
              value={personnelCount}
              onChange={(e) => setPersonnelCount(Number(e.target.value))}
              className="w-28 rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
            />
          </label>
          <button
            onClick={() => runPlacement()}
            disabled={loading}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "계산 중..." : "미리보기"}
          </button>
        </div>
        <p className="text-[11px] text-silver-400">
          그 달에 예정된 종합점검·작동점검·아파트 점검을 한 번에 배치합니다. 인원수를
          바꿔서 다시 미리보기하면 배치가 새로 계산됩니다. 법정 한도(면적·세대수)를
          지키는 것과 별개로, 이동시간을 포함해 통상 근무시간(점심 제외 7시간) 안에
          끝나는지도 함께 확인합니다 — 이 시간 기준은 참고치일 뿐 법적 기준은
          아니며, 실제 소요시간은 건물 구조·설비 복잡도에 따라 달라질 수 있습니다.
          인원이 부족해 못 배치된 건물이 있으면 필요한 최소 인원수를 추천해주는데,
          건물이 많은 달은 이 계산에 시간이 좀 걸릴 수 있습니다.
        </p>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {lastApplied && (
          <p className="text-[13px] font-medium text-[#1d7a34]">
            ✓ {lastApplied.month} 배치를 인원 {lastApplied.personnelCount}명 기준으로
            적용했습니다 (총 {lastApplied.dayCount}일)
          </p>
        )}
      </div>

      {result && (
        <>
          <p className="text-[11px] text-silver-400">
            인원 {resultPersonnelCount}명 기준 배치 결과입니다. 주말은 배치 대상에서
            빠지고 평일에만 배치되며, 목록에 없는 평일은 그날 배치할 대상이 없어서
            (다른 날짜에 이미 배치됨) 표시되지 않은 것입니다.
          </p>
          {result.warnings.length > 0 && (
            <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
              <div className="mb-1 flex items-center justify-between">
                <p className="font-medium text-[#d70015]">제외된 건물이 있어요</p>
                {result.warnings.some((w) => w.includes("연면적")) && (
                  <Link
                    href="/buildings/missing-area"
                    className="text-[12px] font-medium text-accent-600 transition-colors duration-150 hover:text-accent-500"
                  >
                    연면적 건축물대장으로 불러오기 →
                  </Link>
                )}
              </div>
              <ul className="flex flex-col gap-1 text-[#8a1f18]">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-silver-200 px-4 py-2.5 text-[13px]">
            <span className="text-graphite">
              총 {result.days.length}일 배치 · 인원 {resultPersonnelCount}명 기준
            </span>
            <button
              onClick={() => applyResult()}
              disabled={applying}
              className="rounded-lg border border-[#ffb3ad] bg-white px-3 py-1.5 text-[13px] font-medium text-[#d70015] transition-all duration-150 hover:bg-[#fdeceb] active:scale-[0.98] disabled:opacity-50"
            >
              {applying ? "적용 중..." : "이대로 적용"}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {result.days.map((day) => (
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
                          {([
                            ["comprehensive", comprehensiveItems],
                            ["operational", operationalItems],
                          ] as const).map(
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

          {result.unplaced.length > 0 && (
            <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
              <p className="mb-1 font-medium text-[#d70015]">배치되지 못한 건물</p>
              <ul className="flex flex-col gap-1 text-[#8a1f18]">
                {result.unplaced.map((u) => (
                  <li key={u.inspectionId}>
                    [{u.category}] {u.name} — {u.reason}
                  </li>
                ))}
              </ul>
              {result.recommendedPersonnelCount != null && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#f5d4d1] pt-3">
                  <p className="text-[#8a1f18]">
                    이번 달 안에 전부 배치하려면 최소 약{" "}
                    <span className="font-semibold">{result.recommendedPersonnelCount}명</span>이
                    필요합니다 (참고용 추정치 - 실시간 교통 상황 반영으로 계산할 때마다
                    1명 정도 달라질 수 있습니다).
                  </p>
                  <button
                    onClick={() => runPlacement(result.recommendedPersonnelCount!)}
                    disabled={loading}
                    className="shrink-0 rounded-lg bg-[#d70015] px-3 py-1.5 text-[12px] font-medium text-white transition-all duration-150 hover:bg-[#b8000f] active:scale-[0.98] disabled:opacity-50"
                  >
                    {result.recommendedPersonnelCount}명으로 다시 계산
                  </button>
                </div>
              )}
              {result.recommendedPersonnelCount == null &&
                result.unplaced.some((u) => u.reasonCode === "capacity") && (
                  <p className="mt-3 border-t border-[#f5d4d1] pt-3 text-[#8a1f18]">
                    인원을 크게 늘려도(200명까지 확인) 이번 달 안에 전부 배치하기 어렵습니다 -
                    일부를 다음 달로 넘기는 걸 권장합니다.
                  </p>
                )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
