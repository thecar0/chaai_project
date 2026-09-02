"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMonthOnly } from "@/lib/inspection-format";

export type BuildingRow = {
  id: number;
  name: string;
  address: string | null;
  useApprovalDate: string | null;
  recurringInspectionMonth: number | null;
  teamId: number | null;
  teamName: string | null;
};

export type TeamOption = { id: number; name: string };

const GROUP_PAGE_SIZE = 15;
const SPECIAL_GROUP = "특수기호";

// 초성(ㄲ/ㄸ/ㅃ/ㅆ/ㅉ)은 기본 자음 그룹으로 합쳐서 14개 그룹으로 나눈다 (전화번호부 방식).
const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const CHOSUNG_TO_GROUP: Record<string, string> = {
  ㄱ: "ㄱ", ㄲ: "ㄱ", ㄴ: "ㄴ", ㄷ: "ㄷ", ㄸ: "ㄷ", ㄹ: "ㄹ", ㅁ: "ㅁ",
  ㅂ: "ㅂ", ㅃ: "ㅂ", ㅅ: "ㅅ", ㅆ: "ㅅ", ㅇ: "ㅇ", ㅈ: "ㅈ", ㅉ: "ㅈ",
  ㅊ: "ㅊ", ㅋ: "ㅋ", ㅌ: "ㅌ", ㅍ: "ㅍ", ㅎ: "ㅎ",
};
const GROUP_ORDER = [
  "ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", SPECIAL_GROUP,
];

function getInitialGroup(name: string): string {
  const ch = name.trim().charAt(0);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const chosungIndex = Math.floor((code - 0xac00) / (21 * 28));
    return CHOSUNG_TO_GROUP[CHOSUNG[chosungIndex]] ?? SPECIAL_GROUP;
  }
  return SPECIAL_GROUP;
}

export default function BuildingsTable({
  buildings,
  teams,
  initialTeamFilter,
}: {
  buildings: BuildingRow[];
  teams: TeamOption[];
  initialTeamFilter?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  // "all" | "unassigned" | "<teamId>"
  const [teamFilter, setTeamFilter] = useState(initialTeamFilter ?? "all");
  const [bulkTeamValue, setBulkTeamValue] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const teamFilteredBuildings = useMemo(() => {
    if (teamFilter === "all") return buildings;
    if (teamFilter === "unassigned") return buildings.filter((b) => b.teamId == null);
    const teamId = Number(teamFilter);
    return buildings.filter((b) => b.teamId === teamId);
  }, [buildings, teamFilter]);

  const filteredBuildings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teamFilteredBuildings;
    return teamFilteredBuildings.filter(
      (b) => b.name.toLowerCase().includes(q) || (b.useApprovalDate ?? "").includes(q)
    );
  }, [teamFilteredBuildings, query]);

  const groupedBuildings = useMemo(() => {
    const map = new Map<string, BuildingRow[]>();
    for (const b of filteredBuildings) {
      const g = getInitialGroup(b.name);
      const list = map.get(g) ?? [];
      list.push(b);
      map.set(g, list);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      items: map.get(g)!,
    }));
  }, [filteredBuildings]);

  const allSelected =
    filteredBuildings.length > 0 && selected.size === filteredBuildings.length;
  const someSelected = selected.size > 0 && !allSelected;

  useMemo(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filteredBuildings.map((b) => b.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandGroup(group: string) {
    setExpandedGroups((prev) => new Set(prev).add(group));
  }

  function toggleGroup(items: BuildingRow[]) {
    const allIn = items.every((b) => selected.has(b.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of items) {
        if (allIn) next.delete(b.id);
        else next.add(b.id);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `선택한 ${selected.size}건을 삭제할까요? 연결된 점검 일정도 함께 삭제되며 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;

    setDeleting(true);
    const res = await fetch("/api/buildings/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setDeleting(false);

    if (!res.ok) {
      const data = await res.json();
      alert(typeof data.error === "string" ? data.error : "삭제에 실패했습니다.");
      return;
    }

    setSelected(new Set());
    router.refresh();
  }

  async function handleReassignTeam() {
    if (selected.size === 0 || bulkTeamValue === "") return;
    setReassigning(true);

    const res = await fetch("/api/buildings/bulk-team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: Array.from(selected),
        teamId: bulkTeamValue === "unassigned" ? null : Number(bulkTeamValue),
      }),
    });
    setReassigning(false);

    if (!res.ok) {
      const data = await res.json();
      alert(typeof data.error === "string" ? data.error : "팀 변경에 실패했습니다.");
      return;
    }

    setSelected(new Set());
    setBulkTeamValue("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 날짜(YYYY-MM-DD)로 검색"
            className="w-full max-w-xs rounded-lg border border-silver-300 bg-white px-3.5 py-2 text-[13px] outline-none transition-all duration-150 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
          />
          {teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="shrink-0 rounded-lg border border-silver-300 bg-white px-3 py-2 text-[13px] outline-none transition-all duration-150 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
            >
              <option value="all">전체 팀</option>
              <option value="unassigned">미배정</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/buildings/missing-address"
            className="rounded-lg border border-silver-300 bg-white px-4 py-2.5 text-sm font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98]"
          >
            주소 채우기
          </Link>
          <Link
            href="/buildings/missing-area"
            className="rounded-lg border border-silver-300 bg-white px-4 py-2.5 text-sm font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98]"
          >
            연면적 채우기
          </Link>
          <Link
            href="/buildings/import"
            className="rounded-lg border border-silver-300 bg-white px-4 py-2.5 text-sm font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98]"
          >
            엑셀로 일괄 등록
          </Link>
          <Link
            href="/buildings/new"
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98]"
          >
            건축물대장 등록
          </Link>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-silver-200 px-4 py-2.5 text-[13px]">
          <span className="text-graphite">{selected.size}건 선택됨</span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setSelected(new Set())}
              className="text-silver-500 transition-colors duration-150 hover:text-ink"
            >
              선택 해제
            </button>
            <div className="flex items-center gap-1.5">
              <select
                value={bulkTeamValue}
                onChange={(e) => setBulkTeamValue(e.target.value)}
                className="rounded-lg border border-silver-300 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              >
                <option value="">담당 팀 변경...</option>
                <option value="unassigned">미배정으로 변경</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}로 변경
                  </option>
                ))}
              </select>
              <button
                onClick={handleReassignTeam}
                disabled={reassigning || bulkTeamValue === ""}
                className="rounded-lg border border-silver-300 bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98] disabled:opacity-50"
              >
                {reassigning ? "변경 중..." : "적용"}
              </button>
            </div>
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="rounded-lg border border-[#ffb3ad] bg-white px-3 py-1.5 text-[13px] font-medium text-[#d70015] transition-all duration-150 hover:bg-[#fdeceb] active:scale-[0.98] disabled:opacity-50"
            >
              {deleting ? "삭제 중..." : "선택 삭제"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        {filteredBuildings.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-silver-500">
            해당하는 건축물이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
                  <th className="w-10 px-5 py-3">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="전체 선택"
                      className="h-4 w-4 accent-ink"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">건축물명</th>
                  <th className="px-5 py-3 font-medium">주소</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">사용승인일</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">담당 팀</th>
                </tr>
              </thead>
              <tbody>
                {groupedBuildings.map(({ group, items }) => {
                  const isExpanded = expandedGroups.has(group);
                  const visibleItems = isExpanded ? items : items.slice(0, GROUP_PAGE_SIZE);
                  const remaining = items.length - visibleItems.length;

                  const groupAllSelected = items.every((b) => selected.has(b.id));
                  const groupSomeSelected = !groupAllSelected && items.some((b) => selected.has(b.id));

                  return (
                    <Fragment key={group}>
                      <tr>
                        <td colSpan={5} className="bg-silver-100 px-5 py-1.5">
                          <label className="flex items-center gap-2 text-[12px] font-semibold text-silver-500">
                            <input
                              type="checkbox"
                              checked={groupAllSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = groupSomeSelected;
                              }}
                              onChange={() => toggleGroup(items)}
                              aria-label={`${group} 그룹 전체 선택`}
                              className="h-3.5 w-3.5 accent-ink"
                            />
                            {group} · {items.length}건
                          </label>
                        </td>
                      </tr>
                      {visibleItems.map((b) => (
                        <tr
                          key={b.id}
                          className={`border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50 ${
                            selected.has(b.id) ? "bg-accent-50" : ""
                          }`}
                        >
                          <td className="px-5 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(b.id)}
                              onChange={() => toggleOne(b.id)}
                              aria-label={`${b.name} 선택`}
                              className="h-4 w-4 accent-ink"
                            />
                          </td>
                          <td className="px-5 py-3 font-medium">
                            <Link
                              href={`/buildings/${b.id}`}
                              className="transition-colors duration-150 hover:text-accent-600"
                            >
                              {b.name}
                            </Link>
                          </td>
                          <td
                            className="max-w-[260px] truncate px-5 py-3 text-graphite"
                            title={b.address ?? undefined}
                          >
                            {b.address ?? "-"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-graphite">
                            {formatMonthOnly(b)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-graphite">
                            {b.teamName ?? <span className="text-silver-400">미배정</span>}
                          </td>
                        </tr>
                      ))}
                      {remaining > 0 && (
                        <tr>
                          <td colSpan={5} className="px-5 py-2 text-center">
                            <button
                              onClick={() => expandGroup(group)}
                              className="text-[12px] font-medium text-accent-600 transition-colors duration-150 hover:text-accent-500"
                            >
                              더보기 ({remaining}건 더)
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
