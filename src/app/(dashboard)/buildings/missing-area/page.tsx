import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import MissingAreaTable from "@/components/buildings/MissingAreaTable";

export default async function MissingAreaPage() {
  const session = await getSession();
  const rows = session
    ? await db.query.buildings.findMany({
        where: and(eq(buildings.userId, session.userId), isNull(buildings.totalFloorAreaM2)),
        columns: { id: true, name: true, address: true },
        orderBy: (b, { asc }) => [asc(b.name)],
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">연면적 채우기</h1>
        <p className="mt-1 max-w-xl text-[13px] text-silver-500">
          연면적이 비어있으면 점검인력 배치 계산이 불가능합니다. 각 건물마다
          &ldquo;건축물대장에서 불러오기&rdquo;를 눌러 정부 데이터에서 연면적을
          채워 넣으세요.
        </p>
      </div>
      <MissingAreaTable buildings={rows} />
    </div>
  );
}
