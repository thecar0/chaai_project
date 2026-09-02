import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { JusoApiError, lookupAddressForRegistry } from "@/lib/gov-api/juso";
import {
  BuildingRegistryApiError,
  fetchBuildingRegistry,
} from "@/lib/gov-api/building-registry";

type ComparisonField = {
  field: string;
  label: string;
  ourValue: string | number | null;
  govValue: string | number | null;
  match: boolean;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const applyAreaOnly = body?.applyAreaOnly === true;

  const building = await db.query.buildings.findFirst({
    where: and(eq(buildings.id, Number(params.id)), eq(buildings.userId, session.userId)),
  });
  if (!building) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!building.address) {
    return NextResponse.json(
      { error: "주소가 없어 조회할 수 없습니다. 먼저 주소 채우기로 주소를 채워주세요." },
      { status: 400 }
    );
  }

  try {
    const registryParams = await lookupAddressForRegistry(building.address);
    if (!registryParams) {
      return NextResponse.json(
        { error: "입력된 주소로 법정동코드를 찾을 수 없습니다. 주소를 확인해주세요." },
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

    const comparisons: ComparisonField[] = [
      {
        field: "useApprovalDate",
        label: "사용승인일",
        ourValue: building.useApprovalDate,
        govValue: registry.useApprovalDate,
        match: building.useApprovalDate === registry.useApprovalDate,
      },
      {
        field: "totalFloorAreaM2",
        label: "연면적(㎡)",
        ourValue: building.totalFloorAreaM2,
        govValue: registry.totalFloorAreaM2,
        match: building.totalFloorAreaM2 === registry.totalFloorAreaM2,
      },
      {
        field: "floorCount",
        label: "지상 층수",
        ourValue: building.floorCount,
        govValue: registry.groundFloorCount,
        match: building.floorCount === registry.groundFloorCount,
      },
      {
        field: "buildingType",
        label: "주용도",
        ourValue: building.buildingType,
        govValue: registry.mainPurpose,
        match: building.buildingType === registry.mainPurpose,
      },
    ];

    let applied = false;
    if (applyAreaOnly && registry.totalFloorAreaM2 != null) {
      await db
        .update(buildings)
        .set({ totalFloorAreaM2: registry.totalFloorAreaM2 })
        .where(eq(buildings.id, building.id));
      applied = true;
    }

    return NextResponse.json({ comparisons, checkedAt: new Date().toISOString(), applied });
  } catch (err) {
    if (err instanceof JusoApiError || err instanceof BuildingRegistryApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
