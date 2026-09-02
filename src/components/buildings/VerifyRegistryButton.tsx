"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ComparisonField = {
  field: string;
  label: string;
  ourValue: string | number | null;
  govValue: string | number | null;
  match: boolean;
};

export default function VerifyRegistryButton({ buildingId }: { buildingId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [replacingField, setReplacingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestAddressFix, setSuggestAddressFix] = useState(false);
  const [comparisons, setComparisons] = useState<ComparisonField[] | null>(null);

  async function fetchComparisons() {
    const res = await fetch(`/api/buildings/${buildingId}/verify-registry`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "정부 데이터 조회에 실패했습니다");
      setSuggestAddressFix(Boolean(data.suggestAddressFix));
      return false;
    }
    setComparisons(data.comparisons);
    return true;
  }

  async function handleVerify() {
    setLoading(true);
    setError(null);
    setSuggestAddressFix(false);
    setComparisons(null);
    await fetchComparisons();
    setLoading(false);
  }

  async function handleReplace(field: string) {
    setReplacingField(field);
    setError(null);

    const res = await fetch(`/api/buildings/${buildingId}/verify-registry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applyField: field }),
    });
    const data = await res.json();

    if (!res.ok) {
      setReplacingField(null);
      setError(data.error ?? "정부 데이터로 대체하는 데 실패했습니다");
      return;
    }
    // 대체 후에는 최신 비교 결과를 다시 받아와서 화면을 갱신한다.
    setComparisons(data.comparisons);
    setReplacingField(null);
    router.refresh();
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

      {error && (
        <div className="max-w-md text-[13px] text-red-600">
          <p>{error}</p>
          {suggestAddressFix && (
            <Link
              href={`/buildings/${buildingId}/edit`}
              className="mt-1 inline-block font-medium underline hover:text-red-700"
            >
              건물 수정에서 주소 다시 찾기 →
            </Link>
          )}
        </div>
      )}

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
                {!c.match && c.govValue != null && (
                  <button
                    onClick={() => handleReplace(c.field)}
                    disabled={replacingField === c.field}
                    className="rounded-lg border border-silver-300 bg-white px-2.5 py-1 text-[11px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98] disabled:opacity-50"
                  >
                    {replacingField === c.field ? "대체 중..." : "대체"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
