"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
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
    </button>
  );
}
