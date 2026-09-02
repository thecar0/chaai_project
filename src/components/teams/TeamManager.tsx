"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Team = { id: number; name: string; personnelCount: number; buildingCount: number };

export default function TeamManager({
  initialTeams,
  unassignedCount,
}: {
  initialTeams: Team[];
  unassignedCount: number;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(initialTeams);
  const [newName, setNewName] = useState("");
  const [newPersonnelCount, setNewPersonnelCount] = useState(3);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingPersonnelId, setSavingPersonnelId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), personnelCount: newPersonnelCount }),
    });
    const data = await res.json();
    setCreating(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "팀 생성에 실패했습니다.");
      return;
    }
    setTeams((prev) => [...prev, { ...data.team, buildingCount: 0 }]);
    setNewName("");
    setNewPersonnelCount(3);
  }

  async function handleRename(id: number) {
    if (!renameValue.trim()) return;
    setError(null);

    const res = await fetch(`/api/teams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "팀 이름 변경에 실패했습니다.");
      return;
    }
    setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, name: data.team.name } : t)));
    setRenamingId(null);
  }

  async function handlePersonnelChange(id: number, value: number) {
    if (!Number.isInteger(value) || value < 3) return;
    setSavingPersonnelId(id);
    setError(null);

    const res = await fetch(`/api/teams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personnelCount: value }),
    });
    const data = await res.json();
    setSavingPersonnelId(null);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "인원수 변경에 실패했습니다.");
      return;
    }
    setTeams((prev) =>
      prev.map((t) => (t.id === id ? { ...t, personnelCount: data.team.personnelCount } : t))
    );
  }

  async function handleDelete(team: Team) {
    if (
      !window.confirm(
        `"${team.name}" 팀을 삭제할까요? 소속된 건물 ${team.buildingCount}건은 삭제되지 않고 미배정 상태가 됩니다.`
      )
    ) {
      return;
    }
    setError(null);

    const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "팀 삭제에 실패했습니다.");
      return;
    }
    setTeams((prev) => prev.filter((t) => t.id !== team.id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-silver-300/70 bg-white p-5 shadow-sm"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="새 팀 이름 (예: 1팀)"
          className="min-w-0 flex-1 rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
        />
        <label className="flex shrink-0 items-center gap-2 text-[13px] text-silver-500">
          인원수
          <input
            type="number"
            min={3}
            value={newPersonnelCount}
            onChange={(e) => setNewPersonnelCount(Number(e.target.value))}
            className="w-20 rounded-lg border border-silver-300 bg-silver-50 px-2.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50"
        >
          {creating ? "만드는 중..." : "팀 추가"}
        </button>
      </form>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        {teams.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-silver-500">
            아직 만든 팀이 없습니다. 위에서 팀을 먼저 만들어보세요.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
                <th className="px-5 py-3 font-medium">팀 이름</th>
                <th className="px-5 py-3 font-medium">인원수</th>
                <th className="px-5 py-3 font-medium">담당(고정) 건물 수</th>
                <th className="px-5 py-3 font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr
                  key={team.id}
                  className="border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50"
                >
                  <td className="px-5 py-3 font-medium">
                    {renamingId === team.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        className="rounded-lg border border-silver-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
                      />
                    ) : (
                      team.name
                    )}
                  </td>
                  <td className="px-5 py-3 text-graphite">
                    <input
                      type="number"
                      min={3}
                      defaultValue={team.personnelCount}
                      key={team.personnelCount}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== team.personnelCount) handlePersonnelChange(team.id, v);
                      }}
                      disabled={savingPersonnelId === team.id}
                      className="w-16 rounded-lg border border-silver-300 bg-white px-2 py-1 text-sm outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
                    />
                    명
                  </td>
                  <td className="px-5 py-3 text-graphite">
                    <Link
                      href={`/buildings?team=${team.id}`}
                      className="hover:text-accent-600 hover:underline"
                    >
                      {team.buildingCount}건
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {renamingId === team.id ? (
                        <>
                          <button
                            onClick={() => handleRename(team.id)}
                            className="rounded-lg border border-silver-300 bg-white px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent-500 hover:text-accent-600"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="rounded-lg border border-silver-300 bg-white px-2.5 py-1 text-[12px] font-medium text-silver-500 hover:text-graphite"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setRenamingId(team.id);
                              setRenameValue(team.name);
                            }}
                            className="rounded-lg border border-silver-300 bg-white px-2.5 py-1 text-[12px] font-medium text-ink hover:border-accent-500 hover:text-accent-600"
                          >
                            이름 변경
                          </button>
                          <button
                            onClick={() => handleDelete(team)}
                            className="rounded-lg border border-silver-300 bg-white px-2.5 py-1 text-[12px] font-medium text-red-600 hover:border-red-400"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[12px] text-silver-400">
        배치 실행 시, 위에서 담당(고정)으로 지정한 건물은 반드시 그 팀에 들어가고, 나머지
        미배정 건물은 각 팀의 담당 건물과 가까운 곳부터 자동으로 나눠 배치됩니다. 팀마다
        기준이 될 건물을 최소 1개 이상 지정해야 자동 배정이 동작합니다.
      </p>

      {unassignedCount > 0 && (
        <p className="text-[12px] text-silver-500">
          팀이 지정되지 않은 건물이{" "}
          <Link href="/buildings?team=unassigned" className="text-accent-600 hover:underline">
            {unassignedCount}건
          </Link>{" "}
          있습니다.
        </p>
      )}
    </div>
  );
}
