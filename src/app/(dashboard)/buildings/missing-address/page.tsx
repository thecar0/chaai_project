import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import MissingAddressTable from "@/components/buildings/MissingAddressTable";
import BackButton from "@/components/BackButton";

export default async function MissingAddressPage() {
  const session = await getSession();
  const rows = session
    ? await db.query.buildings.findMany({
        where: and(eq(buildings.userId, session.userId), isNull(buildings.address)),
        columns: { id: true, name: true },
        orderBy: (b, { asc }) => [asc(b.name)],
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <BackButton href="/buildings" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">주소 채우기</h1>
        <p className="mt-1 max-w-xl text-[13px] text-silver-500">
          주소가 비어있으면 거리 계산과 정부 데이터 조회가 불가능합니다. 각
          건물마다 &ldquo;이름으로 주소 찾기&rdquo;를 눌러 건축물명으로 도로명주소를
          검색해 채워 넣으세요.
        </p>
      </div>
      <MissingAddressTable buildings={rows} />
    </div>
  );
}
