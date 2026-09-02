import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-silver-100 px-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        소방점검 일정 자동화 시스템
      </h1>
      <p className="max-w-md text-[15px] leading-relaxed text-graphite">
        건축물대장 정보를 등록하면 사용승인일을 기준으로 종합점검·작동점검
        일정을 자동으로 계산해 캘린더에 등록합니다.
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98]"
        >
          로그인
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-silver-300 bg-white px-5 py-2.5 text-sm font-medium text-ink transition-all duration-150 hover:border-accent-500 hover:text-accent-600 active:scale-[0.98]"
        >
          회원가입
        </Link>
      </div>
    </main>
  );
}
