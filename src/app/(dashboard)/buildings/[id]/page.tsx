import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import {
  STATUS_BADGE_CLASS,
  STATUS_LABEL,
  TYPE_LABEL,
  formatApprovalBasis,
} from "@/lib/inspection-format";
import VerifyRegistryButton from "@/components/buildings/VerifyRegistryButton";
import BuildingDetailActions from "@/components/buildings/BuildingDetailActions";
import BackButton from "@/components/BackButton";

export default async function BuildingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const building = await db.query.buildings.findFirst({
    where: and(eq(buildings.id, Number(params.id)), eq(buildings.userId, session.userId)),
    with: { inspections: true },
  });

  if (!building) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BackButton href="/buildings" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{building.name}</h1>
          <p className="mt-1 text-[13px] text-silver-500">
            {building.address ?? "주소 없음 - 주소 채우기에서 채워주세요"}
          </p>
        </div>
        <BuildingDetailActions buildingId={building.id} buildingName={building.name} />
      </div>

      <dl className="grid max-w-md grid-cols-2 gap-y-3 rounded-2xl border border-silver-300/70 bg-white p-6 text-[13px] shadow-sm">
        <dt className="text-silver-500">주용도</dt>
        <dd>{building.buildingType}</dd>
        <dt className="text-silver-500">연면적</dt>
        <dd>{building.totalFloorAreaM2 ? `${building.totalFloorAreaM2}㎡` : "-"}</dd>
        <dt className="text-silver-500">층수</dt>
        <dd>{building.floorCount ?? "-"}</dd>
        <dt className="text-silver-500">사용승인일</dt>
        <dd>{formatApprovalBasis(building)}</dd>
        <dt className="text-silver-500">소방안전등급</dt>
        <dd>{building.fireSafetyGrade ?? "-"}</dd>
      </dl>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
          정부 데이터 대조
        </h2>
        <VerifyRegistryButton buildingId={building.id} />
      </div>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight">
          자동 생성된 점검 일정
        </h2>
        <ul className="flex flex-col gap-2">
          {building.inspections.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between rounded-xl border border-silver-300/70 bg-white px-4 py-3 text-[13px] shadow-sm"
            >
              <span className="font-medium">{TYPE_LABEL[i.inspectionType] ?? i.inspectionType}</span>
              <span className="text-graphite">{i.scheduledDate}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASS[i.status]}`}
              >
                {STATUS_LABEL[i.status] ?? i.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
