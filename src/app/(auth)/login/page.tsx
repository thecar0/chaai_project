"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "로그인에 실패했습니다");
      return;
    }
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/calendar");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-silver-100 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-silver-300/70 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-center text-xl font-semibold tracking-tight">
          로그인
        </h1>
        <p className="mb-7 text-center text-[13px] text-silver-500">
          소방점검 일정 관리
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
            required
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
            required
          />
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
        <p className="mt-6 text-center text-[13px] text-silver-500">
          계정이 없으신가요?{" "}
          <Link
            href="/register"
            className="font-medium text-accent-600 transition-colors duration-150 hover:text-accent-500"
          >
            회원가입
          </Link>
        </p>
      </div>
    </main>
  );
}
