import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { JusoApiError, lookupAddressForRegistry } from "@/lib/gov-api/juso";
import {
  BuildingRegistryApiError,
  fetchBuildingRegistry,
} from "@/lib/gov-api/building-registry";

// 아직 저장되지 않은(등록 폼 작성 중인) 건물을 위한 건축물대장 조회. 기존
// verify-registry는 이미 저장된 건물의 DB 값과 비교/대체하지만, 이건 등록 폼에서
// 주소만으로 연면적·층수·사용승인일·주용도를 미리 가져와 빈 칸을 채우는 용도라
// building id도, 비교 대상도 필요 없다.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!address) {
    return NextResponse.json({ error: "주소를 먼저 입력해주세요." }, { status: 400 });
  }

  try {
    const registryParams = await lookupAddressForRegistry(address);
    if (!registryParams) {
      return NextResponse.json(
        {
          error:
            "입력한 주소로 정부 주소 데이터베이스에서 법정동코드를 찾을 수 없습니다. 지번이 실제와 다르거나 오래되어 없어진 지번일 수 있습니다. 위 '주소 검색'으로 정확한 주소를 다시 찾아 선택해보세요.",
        },
        { status: 422 }
      );
    }

    const registry = await fetchBuildingRegistry(registryParams);
    if (!registry) {
      return NextResponse.json(
        { error: "해당 주소의 건축물대장을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      buildingType: registry.mainPurpose,
      totalFloorAreaM2: registry.totalFloorAreaM2,
      floorCount: registry.groundFloorCount,
      useApprovalDate: registry.useApprovalDate,
    });
  } catch (err) {
    if (err instanceof JusoApiError || err instanceof BuildingRegistryApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
