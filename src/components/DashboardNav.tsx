"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/calendar", label: "캘린더" },
  { href: "/buildings", label: "건축물" },
  { href: "/teams", label: "팀 관리" },
];

export default function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items = isAdmin ? [...LINKS, { href: "/admin", label: "관리자" }] : LINKS;

  return (
    <nav className="flex items-center gap-1 text-[13px] font-medium">
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative rounded-full px-3.5 py-1.5 transition-colors duration-200 ${
              isActive ? "text-white" : "text-white/55 hover:text-white/90"
            }`}
          >
            {item.label}
            <span
              className={`absolute inset-x-3.5 -bottom-[calc(0.375rem+1px)] h-[2px] rounded-full bg-accent-400 transition-opacity duration-200 ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
