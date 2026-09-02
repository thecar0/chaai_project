import Link from "next/link";

// router.back()은 실제 브라우저 히스토리를 따라가기 때문에, 이 페이지에 어떻게
// 들어왔는지에 따라 엉뚱한 곳(예: 캘린더)으로 돌아갈 수 있다. 그래서 "뒤로가기"를
// 예측 가능하게 만들기 위해 목적지를 명시적으로 받는다 - 항상 그 목록 페이지로 간다.
export default function BackButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="뒤로 가기"
      className="sticky top-20 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white shadow-lg shadow-ink/20 transition-all duration-150 hover:bg-black hover:shadow-xl hover:shadow-ink/25 active:scale-90"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Link>
  );
}
