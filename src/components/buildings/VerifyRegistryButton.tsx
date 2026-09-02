"use client";

import { useState } from "react";

type ComparisonField = {
  field: string;
  label: string;
  ourValue: string | number | null;
  govValue: string | number | null;
  match: boolean;
};

export default function VerifyRegistryButton({ buildingId }: { buildingId: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonField[] | null>(null);

  async function handleVerify() {
    setLoading(true);
    setError(null);
    setComparisons(null);

    const res = await fetch(`/api/buildings/${buildingId}/verify-registry`, {
      method: "POST",
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "정부 데이터 조회에 실패했습니다");
      return;
    }
    setComparisons(data.comparisons);
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleVerify}
        disabled={loading}
        className="w-fit rounded-lg border border-silver-300 bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {loading ? "정부 데이터 조회 중..." : "정부 데이터와 비교"}
      </button>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {comparisons && (
        <ul className="flex flex-col gap-2">
          {comparisons.map((c) => (
            <li
              key={c.field}
              className="flex items-center justify-between rounded-xl border border-silver-300/70 bg-white px-4 py-2.5 text-[13px] transition-colors duration-150 hover:bg-silver-50"
            >
              <span className="text-silver-500">{c.label}</span>
              <div className="flex items-center gap-3">
                <span>{c.ourValue ?? "-"}</span>
                <span className="text-silver-400">vs</span>
                <span>{c.govValue ?? "-"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.match ? "bg-[#e8f8ec] text-[#1d7a34]" : "bg-[#fdeceb] text-[#d70015]"
                  }`}
                >
                  {c.match ? "일치" : "불일치"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
