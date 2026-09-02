"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Building = {
  id: number;
  name: string;
  address: string | null;
};

export default function MissingAreaTable({ buildings }: { buildings: Building[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, string>>({});
  const [addressFixIds, setAddressFixIds] = useState<Set<number>>(new Set());

  async function fetchFromRegistry(id: number) {
    setLoadingId(id);
    setResults((prev) => ({ ...prev, [id]: "" }));
    setAddressFixIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    const res = await fetch(`/api/buildings/${id}/verify-registry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applyAreaOnly: true }),
    });
    const data = await res.json();
    setLoadingId(null);

    if (!res.ok) {
      setResults((prev) => ({ ...prev, [id]: data.error ?? "불러오기에 실패했습니다." }));
      if (data.suggestAddressFix) {
        setAddressFixIds((prev) => new Set(prev).add(id));
      }
      return;
    }
    if (data.applied) {
      setResults((prev) => ({ ...prev, [id]: "연면적을 불러와 채웠습니다." }));
      router.refresh();
    } else {
      setResults((prev) => ({
        ...prev,
        [id]: "정부 데이터에도 연면적 정보가 없습니다.",
      }));
    }
  }

  if (buildings.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        <p className="px-5 py-8 text-center text-[13px] text-silver-500">
          연면적이 비어있는 건축물이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
            <th className="px-5 py-3 font-medium">건축물명</th>
            <th className="px-5 py-3 font-medium">주소</th>
            <th className="px-5 py-3 font-medium">작업</th>
          </tr>
        </thead>
        <tbody>
          {buildings.map((b) => (
            <tr
              key={b.id}
              className="border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50"
            >
              <td className="px-5 py-3 font-medium">
                <Link href={`/buildings/${b.id}`} className="hover:underline">
                  {b.name}
                </Link>
              </td>
              <td className="px-5 py-3 text-graphite">{b.address ?? "-"}</td>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchFromRegistry(b.id)}
                    disabled={loadingId === b.id}
                    className="rounded-lg border border-silver-300 bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98] disabled:opacity-50"
                  >
                    {loadingId === b.id ? "조회 중..." : "건축물대장에서 불러오기"}
                  </button>
                  {results[b.id] && (
                    <span className="max-w-md text-[12px] text-silver-500">
                      {results[b.id]}
                      {addressFixIds.has(b.id) && (
                        <>
                          {" "}
                          <Link
                            href={`/buildings/${b.id}/edit`}
                            className="font-medium text-accent-600 underline hover:text-accent-500"
                          >
                            주소 다시 찾기 →
                          </Link>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
