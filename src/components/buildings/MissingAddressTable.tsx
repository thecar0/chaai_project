"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Building = {
  id: number;
  name: string;
};

export default function MissingAddressTable({ buildings }: { buildings: Building[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, string>>({});

  async function fillAddress(id: number) {
    setLoadingId(id);
    setResults((prev) => ({ ...prev, [id]: "" }));

    const res = await fetch(`/api/buildings/${id}/fill-address`, { method: "POST" });
    const data = await res.json();
    setLoadingId(null);

    if (!res.ok) {
      setResults((prev) => ({ ...prev, [id]: data.error ?? "주소를 채우지 못했습니다." }));
      return;
    }
    setResults((prev) => ({ ...prev, [id]: `주소를 채웠습니다: ${data.address}` }));
    router.refresh();
  }

  if (buildings.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        <p className="px-5 py-8 text-center text-[13px] text-silver-500">
          주소가 비어있는 건축물이 없습니다.
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
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fillAddress(b.id)}
                    disabled={loadingId === b.id}
                    className="rounded-lg border border-silver-300 bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98] disabled:opacity-50"
                  >
                    {loadingId === b.id ? "검색 중..." : "이름으로 주소 찾기"}
                  </button>
                  {results[b.id] && (
                    <span className="text-[12px] text-silver-500">{results[b.id]}</span>
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
