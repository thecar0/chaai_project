import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildings, users } from "@/db/schema";
import { requireAdminSession } from "@/lib/session";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await db
    .select({
      id: buildings.id,
      name: buildings.name,
      address: buildings.address,
      buildingType: buildings.buildingType,
      useApprovalDate: buildings.useApprovalDate,
      ownerEmail: users.email,
      ownerName: users.name,
    })
    .from(buildings)
    .innerJoin(users, eq(buildings.userId, users.id));

  return NextResponse.json({ buildings: rows });
}
