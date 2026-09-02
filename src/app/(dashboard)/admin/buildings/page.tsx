import { db } from "@/db";
import { buildings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatApprovalBasis } from "@/lib/inspection-format";

export default async function AdminBuildingsPage() {
  const rows = await db
    .select({
      id: buildings.id,
      name: buildings.name,
      address: buildings.address,
      buildingType: buildings.buildingType,
      useApprovalDate: buildings.useApprovalDate,
      recurringInspectionMonth: buildings.recurringInspectionMonth,
      ownerEmail: users.email,
      ownerName: users.name,
    })
    .from(buildings)
    .innerJoin(users, eq(buildings.userId, users.id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">전체 건축물</h1>
      <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-silver-500">
            등록된 건축물이 없습니다.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
                <th className="px-5 py-3 font-medium">건축물명</th>
                <th className="px-5 py-3 font-medium">주소</th>
                <th className="px-5 py-3 font-medium">주용도</th>
                <th className="px-5 py-3 font-medium">사용승인일</th>
                <th className="px-5 py-3 font-medium">등록자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50"
                >
                  <td className="px-5 py-3 font-medium">{b.name}</td>
                  <td className="px-5 py-3 text-graphite">{b.address ?? "-"}</td>
                  <td className="px-5 py-3 text-graphite">{b.buildingType}</td>
                  <td className="px-5 py-3 text-graphite">{formatApprovalBasis(b)}</td>
                  <td className="px-5 py-3 text-graphite">
                    {b.ownerName} ({b.ownerEmail})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
