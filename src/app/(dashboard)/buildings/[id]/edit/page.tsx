import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import BuildingForm from "@/components/buildings/BuildingForm";

export default async function EditBuildingPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const building = await db.query.buildings.findFirst({
    where: and(eq(buildings.id, Number(params.id)), eq(buildings.userId, session.userId)),
  });
  if (!building) notFound();

  const teamRows = await db.query.teams.findMany({
    where: eq(teams.userId, session.userId),
    columns: { id: true, name: true },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">건축물 정보 수정</h1>
      <BuildingForm initial={building} teams={teamRows} />
    </div>
  );
}
