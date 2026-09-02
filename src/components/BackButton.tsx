"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      aria-label="뒤로 가기"
      className="flex h-8 w-8 items-center justify-center rounded-full text-graphite transition-colors duration-150 hover:bg-silver-100 hover:text-ink active:scale-90"
    >
      ←
    </button>
  );
}
