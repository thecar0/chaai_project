import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LogoutButton from "@/components/LogoutButton";
import DashboardNav from "@/components/DashboardNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-8">
            <Link href="/calendar" className="text-[15px] font-semibold tracking-tight text-white">
              소방점검
            </Link>
            <DashboardNav isAdmin={session.role === "admin"} />
          </div>
          <div className="flex items-center gap-4 text-[13px] text-white/55">
            <span>
              {session.email}
              {session.role === "admin" && (
                <span className="ml-1.5 rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] font-medium text-accent-400">
                  관리자
                </span>
              )}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
