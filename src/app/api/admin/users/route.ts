import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdminSession } from "@/lib/session";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows = await db.query.users.findMany({
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: (u, { desc }) => [desc(u.createdAt)],
  });

  return NextResponse.json({ users: rows });
}
