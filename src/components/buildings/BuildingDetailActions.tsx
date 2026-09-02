"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BuildingDetailActions({
  buildingId,
  buildingName,
}: {
  buildingId: number;
  buildingName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      `"${buildingName}"을(를) 삭제할까요? 연결된 점검 일정도 함께 삭제되며 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;

    setDeleting(true);
    const res = await fetch(`/api/buildings/${buildingId}`, { method: "DELETE" });
    setDeleting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(typeof data.error === "string" ? data.error : "삭제에 실패했습니다.");
      return;
    }

    router.push("/buildings");
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Link
        href={`/buildings/${buildingId}/edit`}
        className="rounded-lg border border-silver-300 bg-white px-3.5 py-2 text-[13px] font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98]"
      >
        수정
      </Link>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="rounded-lg border border-[#ffb3ad] bg-white px-3.5 py-2 text-[13px] font-medium text-[#d70015] transition-all duration-150 hover:bg-[#fdeceb] active:scale-[0.98] disabled:opacity-50"
      >
        {deleting ? "삭제 중..." : "삭제"}
      </button>
    </div>
  );
}
