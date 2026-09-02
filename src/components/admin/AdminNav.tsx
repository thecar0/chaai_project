"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/users", label: "사용자 관리" },
  { href: "/admin/buildings", label: "전체 건축물" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 rounded-full bg-silver-200 p-1 text-[13px] font-medium">
      {LINKS.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-full px-3.5 py-1.5 transition-colors duration-200 ${
              isActive ? "bg-ink text-white" : "text-graphite hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
