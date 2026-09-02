import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { JusoApiError, searchAddressByKeyword } from "@/lib/gov-api/juso";

// 주소가 없는 건물의 이름으로 도로명주소를 검색해 채운다. "연면적 채우기"와
// 동일한 방식 - 정부 데이터에서 1건 조회해서 바로 적용한다.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const building = await db.query.buildings.findFirst({
    where: and(eq(buildings.id, Number(params.id)), eq(buildings.userId, session.userId)),
  });
  if (!building) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (building.address) {
    return NextResponse.json({ error: "이미 주소가 있습니다." }, { status: 400 });
  }

  try {
    const result = await searchAddressByKeyword(building.name);
    if (!result) {
      return NextResponse.json(
        { error: "건축물명으로 주소를 찾지 못했습니다. 이름을 확인하거나 직접 입력해주세요." },
        { status: 404 }
      );
    }

    const address = result.roadAddr || result.jibunAddr;
    await db.update(buildings).set({ address }).where(eq(buildings.id, building.id));

    return NextResponse.json({ applied: true, address });
  } catch (err) {
    if (err instanceof JusoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
