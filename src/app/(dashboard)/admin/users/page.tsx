import { db } from "@/db";
import { getSession } from "@/lib/session";
import UserActions from "@/components/admin/UserActions";

export default async function AdminUsersPage() {
  const session = await getSession();
  const rows = await db.query.users.findMany({
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: (u, { desc }) => [desc(u.createdAt)],
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">사용자 관리</h1>
      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
              <th className="px-5 py-3 font-medium">이름</th>
              <th className="px-5 py-3 font-medium">이메일</th>
              <th className="px-5 py-3 font-medium">권한</th>
              <th className="px-5 py-3 font-medium">상태</th>
              <th className="px-5 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.id}
                className="border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50"
              >
                <td className="px-5 py-3 font-medium">{u.name}</td>
                <td className="px-5 py-3 text-graphite">{u.email}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      u.role === "admin"
                        ? "bg-ink text-white"
                        : "bg-silver-100 text-graphite"
                    }`}
                  >
                    {u.role === "admin" ? "관리자" : "일반"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      u.isActive
                        ? "bg-[#e8f8ec] text-[#1d7a34]"
                        : "bg-[#fdeceb] text-[#d70015]"
                    }`}
                  >
                    {u.isActive ? "활성" : "비활성"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {u.id === session?.userId ? (
                    <span className="text-[12px] text-silver-500">본인 계정</span>
                  ) : (
                    <UserActions userId={u.id} role={u.role} isActive={u.isActive} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
