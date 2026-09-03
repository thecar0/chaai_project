"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PlacementDayList, { type MergedDay } from "./PlacementDayList";

type TeamOption = { id: number; name: string; personnelCount: number };

type UnplacedItem = {
  buildingId: number;
  inspectionId: number;
  name: string;
  reason: string;
  reasonCode: "capacity" | "invalid_amount";
  category: string;
};

type TeamResult = {
  teamId: number;
  teamName: string;
  personnelCount: number;
  days: MergedDay[];
  unplaced: UnplacedItem[];
  autoAssignedBuildingIds: number[];
  trueMinimumPersonnel: number | null;
  warning: "understaffed" | "overstaffed" | null;
};

type DistributeResult = {
  teams: TeamResult[];
  unassignableBuildings: { buildingId: number; name: string }[];
  warnings: string[];
};

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function TeamDistributeForm({
  initialMonth,
  teams,
  onApplied,
}: {
  initialMonth?: string;
  teams: TeamOption[];
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth ?? currentMonthValue());
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    new Set(teams.map((t) => t.id))
  );
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DistributeResult | null>(null);
  const [lastApplied, setLastApplied] = useState<{ month: string; teamCount: number } | null>(null);

  function toggleTeam(id: number) {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runDistribute() {
    if (selectedTeamIds.size === 0) {
      setError("포함할 팀을 1개 이상 선택해주세요.");
      return;
    }
    setError(null);
    setLoading(true);
    setLastApplied(null);
    setResult(null);

    const res = await fetch("/api/schedule/distribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, teamIds: Array.from(selectedTeamIds) }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "배치 계산에 실패했습니다.");
      return;
    }
    setResult(data);
  }

  // 팀별로 각각 계산해둔 날짜·팀 자동 배정 결과를 한 번에 합쳐서 적용한다.
  async function applyAll() {
    if (!result) return;
    const days = result.teams.flatMap((t) =>
      t.days.map((d) => ({
        date: d.date,
        inspectionIds: d.groups.flatMap((g) => g.items.map((i) => i.inspectionId)),
      }))
    );
    if (days.length === 0) return;
    const teamAssignments = result.teams.flatMap((t) =>
      t.autoAssignedBuildingIds.map((buildingId) => ({ buildingId, teamId: t.teamId }))
    );

    setError(null);
    setApplying(true);
    const res = await fetch("/api/schedule/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days, teamAssignments }),
    });
    const data = await res.json();
    setApplying(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "적용에 실패했습니다.");
      return;
    }
    setLastApplied({ month, teamCount: result.teams.length });
    setResult(null);
    router.refresh();
    onApplied?.();
  }

  const totalDays = result ? result.teams.reduce((sum, t) => sum + t.days.length, 0) : 0;

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
          <button
            onClick={() => runDistribute()}
            disabled={loading}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "계산 중..." : "미리보기"}
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-graphite">포함할 팀</p>
          <div className="flex flex-wrap gap-3">
            {teams.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-1.5 rounded-lg border border-silver-300 bg-silver-50 px-3 py-1.5 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={selectedTeamIds.has(t.id)}
                  onChange={() => toggleTeam(t.id)}
                  className="h-4 w-4 accent-ink"
                />
                {t.name} ({t.personnelCount}명)
              </label>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-silver-400">
          체크한 팀에게 그 달 건물 전체를 한 번에 나눠 배치합니다. 팀에 고정 담당으로
          지정된 건물은 그대로 그 팀에 배치되고, 미배정 건물은 거리 기준으로 자동
          배정됩니다(고정 담당을 지정한 팀은 그 위치를 우선 기준으로, 지정하지 않은
          팀은 나머지 건물들의 지역 분포를 보고 자동으로 나뉨). 인원수는 팀 관리에서
          정한 팀별 기본값을 사용합니다 - 바꾸려면 팀 관리에서 수정하세요. 팀·건물이
          많으면 계산에 시간이 좀 걸릴 수 있습니다.
        </p>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {lastApplied && (
          <p className="text-[13px] font-medium text-[#1d7a34]">
            ✓ {lastApplied.month} 배치를 {lastApplied.teamCount}개 팀에 나눠 적용했습니다.
          </p>
        )}
      </div>

      {result && (
        <>
          {result.warnings.length > 0 && (
            <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
              <p className="mb-1 font-medium text-[#d70015]">제외된 건물이 있어요</p>
              <ul className="flex flex-col gap-1 text-[#8a1f18]">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.unassignableBuildings.length > 0 && (
            <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
              <p className="mb-1 font-medium text-[#d70015]">
                자동 배정하지 못한 미배정 건물 {result.unassignableBuildings.length}건
              </p>
              <p className="mb-2 text-[#8a1f18]">
                주소가 없어서 좌표를 못 구해 거리 기준을 잡을 수 없었습니다.
              </p>
              <ul className="flex flex-col gap-1 text-[#8a1f18]">
                {result.unassignableBuildings.map((b) => (
                  <li key={b.buildingId}>{b.name}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-silver-200 px-4 py-2.5 text-[13px]">
            <span className="text-graphite">
              {result.teams.length}개 팀 · 총 {totalDays}일 배치
            </span>
            <button
              onClick={() => applyAll()}
              disabled={applying || totalDays === 0}
              className="rounded-lg border border-[#ffb3ad] bg-white px-3 py-1.5 text-[13px] font-medium text-[#d70015] transition-all duration-150 hover:bg-[#fdeceb] active:scale-[0.98] disabled:opacity-50"
            >
              {applying ? "적용 중..." : "이대로 전체 적용"}
            </button>
          </div>

          <div className="flex flex-col gap-6">
            {result.teams.map((t) => (
              <div key={t.teamId} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold tracking-tight">{t.teamName}</h3>
                  <span className="text-[12px] text-silver-500">인원 {t.personnelCount}명 기준</span>
                  {t.autoAssignedBuildingIds.length > 0 && (
                    <span className="text-[12px] text-silver-500">
                      · 미배정 중 {t.autoAssignedBuildingIds.length}건 자동 포함
                    </span>
                  )}
                  {t.warning === "understaffed" && t.trueMinimumPersonnel != null && (
                    <span className="rounded-full bg-[#fdeceb] px-2.5 py-1 text-[12px] font-medium text-[#d70015]">
                      인원 부족 - 최소 약 {t.trueMinimumPersonnel}명 필요
                    </span>
                  )}
                  {t.warning === "overstaffed" && t.trueMinimumPersonnel != null && (
                    <span className="rounded-full bg-[#fff4e0] px-2.5 py-1 text-[12px] font-medium text-[#b25e00]">
                      여유 있음 - {t.trueMinimumPersonnel}명이면 충분 (인원을 줄이거나 다른
                      팀으로 재배치하는 걸 고려하세요)
                    </span>
                  )}
                </div>

                {t.days.length === 0 ? (
                  <p className="rounded-2xl border border-silver-300/70 bg-white p-5 text-[13px] text-silver-500 shadow-sm">
                    이번 달에 이 팀이 담당(고정 또는 근처 미배정)할 건물이 없습니다.
                  </p>
                ) : (
                  <PlacementDayList days={t.days} />
                )}

                {t.unplaced.length > 0 && (
                  <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
                    <p className="mb-1 font-medium text-[#d70015]">배치되지 못한 건물</p>
                    <ul className="flex flex-col gap-1 text-[#8a1f18]">
                      {t.unplaced.map((u) => (
                        <li key={u.inspectionId}>
                          [{u.category}] {u.name} — {u.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
