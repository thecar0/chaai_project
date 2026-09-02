import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { JusoApiError, searchAddressCandidates } from "@/lib/gov-api/juso";

// 건물 등록/수정 폼에서 주소를 직접 검색해 고를 수 있게 하는 후보 목록 조회.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const keyword = req.nextUrl.searchParams.get("q")?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "검색어를 입력해주세요." }, { status: 400 });
  }

  try {
    const results = await searchAddressCandidates(keyword);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof JusoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
