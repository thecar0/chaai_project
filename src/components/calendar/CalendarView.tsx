"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DISPLAY_STATUS_BADGE_CLASS,
  DISPLAY_STATUS_DOT_CLASS,
  DISPLAY_STATUS_LABEL,
  TYPE_LABEL,
  getDisplayStatus,
  type DisplayStatus,
  type InspectionStatus,
  type InspectionType,
} from "@/lib/inspection-format";
import ScheduleRunForm from "@/components/schedule/ScheduleRunForm";

const MONTH_FILTERS: { key: "all" | "postponed" | "completed"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "postponed", label: "이월" },
  { key: "completed", label: "완료" },
];

type Inspection = {
  id: number;
  inspectionType: InspectionType;
  scheduledDate: string; // YYYY-MM-DD
  status: InspectionStatus;
  isManuallyScheduled: boolean;
  buildingId: number;
  buildingName: string;
  teamId: number | null;
  teamName: string | null;
};

type Team = { id: number; name: string };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const PAGE_SIZE = 8; // 사이드 목록 한 페이지당 표시 개수 (달력 세로 길이에 맞춘 값)

export default function CalendarView() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showPlacement, setShowPlacement] = useState(false);
  const [page, setPage] = useState(0);
  const [monthFilter, setMonthFilter] = useState<"all" | "postponed" | "completed">("all");
  const [teams, setTeams] = useState<Team[]>([]);
  // "all" | "unassigned" | "<teamId>"
  const [teamFilter, setTeamFilter] = useState("all");

  const loadInspections = useCallback(() => {
    fetch("/api/inspections")
      .then((res) => res.json())
      .then((data) => {
        setInspections(data.inspections ?? []);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    loadInspections();
  }, [loadInspections]);

  useEffect(() => {
    fetch("/api/teams")
      .then((res) => res.json())
      .then((data) => setTeams(data.teams ?? []));
  }, []);

  useEffect(() => {
    setPage(0);
  }, [cursor, selectedDate, monthFilter, teamFilter]);

  const days = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const today = useMemo(() => toDateString(new Date()), []);

  // 팀을 고르면 캘린더 전체(그리드 점·사이드 목록·인력 배치)가 그 팀 담당
  // 건물로만 좁혀진다 - "1팀 캘린더"처럼 팀별로 화면을 전환하는 셈.
  const visibleInspections = useMemo(() => {
    if (teamFilter === "all") return inspections;
    if (teamFilter === "unassigned") return inspections.filter((i) => i.teamId == null);
    const teamId = Number(teamFilter);
    return inspections.filter((i) => i.teamId === teamId);
  }, [inspections, teamFilter]);

  const inspectionsByDate = useMemo(() => {
    const map = new Map<string, Inspection[]>();
    for (const insp of visibleInspections) {
      const list = map.get(insp.scheduledDate) ?? [];
      list.push(insp);
      map.set(insp.scheduledDate, list);
    }
    return map;
  }, [visibleInspections]);

  const monthInspections = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    return visibleInspections
      .filter((i) => {
        const d = new Date(i.scheduledDate);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  }, [visibleInspections, cursor]);

  // 이월 기준: 9월에 예정이던 걸 10월로 이월했다면, "옮겨진 날짜(10월)" 기준으로
  // 10월의 이월 탭에 뜬다 (monthInspections가 이미 scheduledDate 기준 월로 걸러져 있음).
  const filteredMonthInspections = useMemo(() => {
    if (monthFilter === "all") return monthInspections;
    if (monthFilter === "completed") return monthInspections.filter((i) => i.status === "completed");
    return monthInspections.filter(
      (i) => getDisplayStatus(i.status, i.isManuallyScheduled) === "postponed"
    );
  }, [monthInspections, monthFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMonthInspections.length / PAGE_SIZE));
  const pagedMonthInspections = useMemo(
    () => filteredMonthInspections.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filteredMonthInspections, page]
  );

  function goToMonth(delta: number) {
    setSelectedDate(null);
    setCursor((c) => addMonths(c, delta));
  }

  async function updateInspection(id: number, body: Record<string, string | boolean>) {
    const res = await fetch(`/api/inspections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { inspection } = await res.json();
      setInspections((prev) =>
        prev.map((i) => (i.id === inspection.id ? { ...i, ...inspection } : i))
      );
    }
  }

  function markCompleted(id: number) {
    return updateInspection(id, { status: "completed" });
  }

  // 완료 취소 - 지연이라는 상태는 없으므로 그냥 예정으로 되돌린다.
  function unmarkCompleted(id: number) {
    return updateInspection(id, { status: "scheduled" });
  }

  // 사용자가 직접 고른 날짜로 이월 - 자동 인력 배치에서 제외되도록 표시해둔다.
  function postponeTo(id: number, newDate: string) {
    return updateInspection(id, { scheduledDate: newDate, isManuallyScheduled: true });
  }

  const cursorMonthValue = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const selectedTeamId = teamFilter === "all" || teamFilter === "unassigned" ? undefined : Number(teamFilter);
  const selectedTeamLabel =
    teamFilter === "all"
      ? undefined
      : teamFilter === "unassigned"
        ? "미배정"
        : (teams.find((t) => t.id === selectedTeamId)?.name ?? undefined);

  return (
    <div className="flex flex-col gap-6">
      {teams.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-silver-200 p-1 text-[13px] w-fit">
          <button
            onClick={() => setTeamFilter("all")}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors duration-200 ${
              teamFilter === "all" ? "bg-ink text-white shadow-sm" : "text-graphite hover:text-ink"
            }`}
          >
            전체
          </button>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setTeamFilter(String(t.id))}
              className={`rounded-full px-3.5 py-1.5 font-medium transition-colors duration-200 ${
                teamFilter === String(t.id) ? "bg-ink text-white shadow-sm" : "text-graphite hover:text-ink"
              }`}
            >
              {t.name}
            </button>
          ))}
          <button
            onClick={() => setTeamFilter("unassigned")}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors duration-200 ${
              teamFilter === "unassigned" ? "bg-ink text-white shadow-sm" : "text-graphite hover:text-ink"
            }`}
          >
            미배정
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {showPlacement && (
            <ScheduleRunForm
              key={`${cursorMonthValue}-${teamFilter}`}
              initialMonth={cursorMonthValue}
              onApplied={loadInspections}
              teamId={selectedTeamId}
              teamLabel={selectedTeamLabel}
            />
          )}

          <div className="rounded-2xl border border-silver-300/70 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => goToMonth(-1)}
                aria-label="이전 달"
                className="flex h-8 w-8 items-center justify-center rounded-full text-graphite transition-colors duration-150 hover:bg-silver-100 hover:text-ink active:scale-90"
              >
                ‹
              </button>
              <h2 className="flex-1 text-center text-[15px] font-semibold tracking-tight">
                {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToMonth(1)}
                  aria-label="다음 달"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-graphite transition-colors duration-150 hover:bg-silver-100 hover:text-ink active:scale-90"
                >
                  ›
                </button>
                <button
                  onClick={() => setShowPlacement((v) => !v)}
                  className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150 active:scale-[0.98] ${
                    showPlacement
                      ? "bg-ink text-white"
                      : "border border-silver-300 bg-white text-ink hover:border-accent-500 hover:text-accent-600"
                  }`}
                >
                  {showPlacement ? "인력 배치 닫기" : "인력 배치"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-silver-500">
              {WEEKDAYS.map((d, idx) => (
                <div
                  key={d}
                  className={
                    idx === 0 ? "pb-2 text-[#ff3b30]" : idx === 6 ? "pb-2 text-accent-500" : "pb-2"
                  }
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {days.map((day, idx) => {
                if (!day) return <div key={`empty-${idx}`} />;
                const key = toDateString(day);
                const dayInspections = inspectionsByDate.get(key) ?? [];
                const isToday = key === today;
                const isSelected = key === selectedDate;
                const weekday = day.getDay();

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(isSelected ? null : key)}
                    className={`flex aspect-square flex-col items-center gap-1 rounded-xl pt-2 transition-colors duration-150 active:scale-95 ${
                      isSelected ? "bg-accent-50" : "hover:bg-silver-100"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] transition-colors duration-150 ${
                        isSelected
                          ? "bg-accent-500 font-semibold text-white"
                          : isToday
                            ? "bg-ink font-semibold text-white"
                            : weekday === 0
                              ? "text-[#ff3b30]"
                              : weekday === 6
                                ? "text-accent-500"
                                : "text-ink"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <div className="flex gap-0.5">
                      {dayInspections.slice(0, 3).map((insp) => (
                        <span
                          key={insp.id}
                          className={`h-1.5 w-1.5 rounded-full ${
                            DISPLAY_STATUS_DOT_CLASS[getDisplayStatus(insp.status, insp.isManuallyScheduled)]
                          }`}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-silver-300/70 bg-white p-5 shadow-sm lg:sticky lg:top-20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold tracking-tight">
              {selectedDate ? formatKoreanDate(selectedDate) : `${cursor.getMonth() + 1}월 점검 일정`}
            </h3>
            {selectedDate && (
              <button
                onClick={() => setSelectedDate(null)}
                className="text-[12px] text-accent-600 transition-colors duration-150 hover:text-accent-500"
              >
                이번 달 전체 보기
              </button>
            )}
          </div>

          {!selectedDate && (
            <div className="mb-3 flex gap-1 rounded-full bg-silver-200 p-1">
              {MONTH_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setMonthFilter(f.key)}
                  className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                    monthFilter === f.key ? "bg-ink text-white shadow-sm" : "text-graphite hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {!loaded ? (
            <p className="text-[13px] text-silver-500">불러오는 중...</p>
          ) : selectedDate ? (
            <InspectionList
              items={inspectionsByDate.get(selectedDate) ?? []}
              onComplete={markCompleted}
              onUncomplete={unmarkCompleted}
              onPostpone={postponeTo}
              emptyText="이 날짜에는 예정된 점검이 없습니다."
            />
          ) : filteredMonthInspections.length === 0 ? (
            <p className="text-[13px] text-silver-500">
              {monthFilter === "all"
                ? "이번 달 예정된 점검이 없습니다."
                : monthFilter === "postponed"
                  ? "이번 달로 이월된 점검이 없습니다."
                  : "이번 달 완료된 점검이 없습니다."}
            </p>
          ) : (
            <>
              <InspectionList
                items={pagedMonthInspections}
                onComplete={markCompleted}
                onUncomplete={unmarkCompleted}
                onPostpone={postponeTo}
                showDate
              />
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-[12px]">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-silver-500 transition-colors duration-150 hover:text-ink disabled:opacity-30"
                  >
                    ‹ 이전
                  </button>
                  <span className="text-silver-400">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-silver-500 transition-colors duration-150 hover:text-ink disabled:opacity-30"
                  >
                    다음 ›
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function InspectionList({
  items,
  onComplete,
  onUncomplete,
  onPostpone,
  emptyText,
  showDate,
}: {
  items: Inspection[];
  onComplete: (id: number) => void;
  onUncomplete: (id: number) => void;
  onPostpone: (id: number, newDate: string) => void;
  emptyText?: string;
  showDate?: boolean;
}) {
  const [postponingId, setPostponingId] = useState<number | null>(null);
  const [pickedDate, setPickedDate] = useState("");

  if (items.length === 0 && emptyText) {
    return <p className="text-[13px] text-silver-500">{emptyText}</p>;
  }

  function startPostpone(insp: Inspection) {
    setPostponingId(insp.id);
    setPickedDate(addOneMonth(insp.scheduledDate));
  }

  function confirmPostpone(id: number) {
    if (!pickedDate) return;
    onPostpone(id, pickedDate);
    setPostponingId(null);
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((insp) => (
        <li
          key={insp.id}
          className="flex flex-col gap-2 rounded-xl bg-silver-50 px-3 py-2.5 transition-colors duration-150 hover:bg-silver-100"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-ink">{insp.buildingName}</span>
              <span className="text-[11px] text-silver-500">
                {showDate && `${formatKoreanDate(insp.scheduledDate)} · `}
                {TYPE_LABEL[insp.inspectionType]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const displayStatus: DisplayStatus = getDisplayStatus(
                  insp.status,
                  insp.isManuallyScheduled
                );
                return (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DISPLAY_STATUS_BADGE_CLASS[displayStatus]}`}
                  >
                    {DISPLAY_STATUS_LABEL[displayStatus]}
                  </span>
                );
              })()}
              {insp.status !== "completed" && (
                <button
                  onClick={() => startPostpone(insp)}
                  title="직접 날짜를 골라 이월합니다 (이 건은 이후 자동 인력 배치에서 제외됩니다)"
                  className="text-[11px] text-silver-500 transition-colors duration-150 hover:text-accent-600 active:scale-95"
                >
                  이월
                </button>
              )}
              {insp.status !== "completed" && (
                <button
                  onClick={() => onComplete(insp.id)}
                  className="text-[11px] text-silver-500 transition-colors duration-150 hover:text-accent-600 active:scale-95"
                >
                  완료
                </button>
              )}
              {insp.status === "completed" && (
                <button
                  onClick={() => onUncomplete(insp.id)}
                  title="완료 처리를 취소하고 예정 상태로 되돌립니다"
                  className="text-[11px] text-silver-500 transition-colors duration-150 hover:text-[#d70015] active:scale-95"
                >
                  완료 취소
                </button>
              )}
            </div>
          </div>
          {postponingId === insp.id && (
            <div className="flex items-center gap-2 border-t border-silver-200 pt-2">
              <input
                type="date"
                value={pickedDate}
                onChange={(e) => setPickedDate(e.target.value)}
                className="flex-1 rounded-lg border border-silver-300 bg-white px-2.5 py-1.5 text-[12px] outline-none transition-all duration-150 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
              />
              <button
                onClick={() => confirmPostpone(insp.id)}
                className="rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98]"
              >
                확정
              </button>
              <button
                onClick={() => setPostponingId(null)}
                className="text-[12px] text-silver-500 transition-colors duration-150 hover:text-ink"
              >
                취소
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function buildMonthGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

// 이월: 같은 날짜의 다음 달로 옮긴다 (예: 8/31처럼 다음 달에 없는 날짜는 28일로 맞춤).
function addOneMonth(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = Math.min(d, 28);
  return toDateString(new Date(y, m, day));
}

function toDateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatKoreanDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
