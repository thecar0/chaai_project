"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserActions({
  userId,
  role,
  isActive,
}: {
  userId: number;
  role: "admin" | "user";
  isActive: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function update(body: Record<string, unknown>) {
    setLoading(true);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json();
      alert(data.error ?? "변경에 실패했습니다");
    }
  }

  return (
    <div className="flex gap-2">
      <button
        disabled={loading}
        onClick={() => update({ isActive: !isActive })}
        className="rounded-full border border-silver-300 px-2.5 py-1 text-[11px] font-medium text-graphite transition-colors duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-95 disabled:opacity-50"
      >
        {isActive ? "비활성화" : "활성화"}
      </button>
      <button
        disabled={loading}
        onClick={() => update({ role: role === "admin" ? "user" : "admin" })}
        className="rounded-full border border-silver-300 px-2.5 py-1 text-[11px] font-medium text-graphite transition-colors duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-95 disabled:opacity-50"
      >
        {role === "admin" ? "일반으로 변경" : "관리자로 변경"}
      </button>
    </div>
  );
}
