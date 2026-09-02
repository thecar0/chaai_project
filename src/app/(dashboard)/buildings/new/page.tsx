import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { getSession } from "@/lib/session";
import BuildingForm from "@/components/buildings/BuildingForm";
import BackButton from "@/components/BackButton";

export default async function NewBuildingPage() {
  const session = await getSession();
  const teamRows = session
    ? await db.query.teams.findMany({
        where: eq(teams.userId, session.userId),
        columns: { id: true, name: true },
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <BackButton href="/buildings" />
      <h1 className="text-2xl font-semibold tracking-tight">건축물대장 등록</h1>
      <BuildingForm teams={teamRows} />
    </div>
  );
}
