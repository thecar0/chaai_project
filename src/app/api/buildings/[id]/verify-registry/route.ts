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
import { maybeGenerateInitialSchedule } from "@/lib/create-building";

type ApplyableField = "useApprovalDate" | "totalFloorAreaM2" | "floorCount" | "buildingType";
const APPLYABLE_FIELDS: ApplyableField[] = [
  "useApprovalDate",
  "totalFloorAreaM2",
  "floorCount",
  "buildingType",
];

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
  const applyField: ApplyableField | undefined = APPLYABLE_FIELDS.includes(body?.applyField)
    ? body.applyField
    : undefined;

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
        {
          error:
            "저장된 주소로 정부 주소 데이터베이스에서 법정동코드를 찾을 수 없습니다. 지번이 실제와 다르게 입력되었거나(예: 오래되어 없어진 지번), 다른 자료에서 옮겨 적는 과정에서 오타가 있을 수 있습니다. 아래에서 주소를 수정하며 '주소 검색'으로 정확한 주소를 다시 찾아 선택해보세요.",
          suggestAddressFix: true,
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
      const areaRow = comparisons.find((c) => c.field === "totalFloorAreaM2");
      if (areaRow) {
        areaRow.ourValue = registry.totalFloorAreaM2;
        areaRow.match = true;
      }
    }

    if (applyField) {
      const govValueByField: Record<ApplyableField, string | number | null> = {
        useApprovalDate: registry.useApprovalDate,
        totalFloorAreaM2: registry.totalFloorAreaM2,
        floorCount: registry.groundFloorCount,
        buildingType: registry.mainPurpose,
      };
      const value = govValueByField[applyField];
      if (value != null) {
        await db
          .update(buildings)
          .set({ [applyField]: value })
          .where(eq(buildings.id, building.id));
        applied = true;
        // 방금 반영한 값으로 비교 결과도 같이 갱신해서 응답에 최신 상태가 그대로 담기게 한다.
        const row = comparisons.find((c) => c.field === applyField);
        if (row) {
          row.ourValue = value;
          row.match = true;
        }
        // 사용승인일이 없어서 점검 일정 없이 있던 건물이 이번 대체로 채워졌으면
        // 최초 일정을 만들어준다.
        if (applyField === "useApprovalDate") {
          await maybeGenerateInitialSchedule(building.id);
        }
      }
    }

    return NextResponse.json({ comparisons, checkedAt: new Date().toISOString(), applied });
  } catch (err) {
    if (err instanceof JusoApiError || err instanceof BuildingRegistryApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
