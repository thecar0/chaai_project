import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { signSessionToken } from "@/lib/jwt";
import { setSessionCookie } from "@/lib/session";
import { registerSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password, name } = parsed.data;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return NextResponse.json(
      { error: "이미 가입된 이메일입니다" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  // 공개 회원가입은 항상 일반 사용자로만 생성한다. 관리자 계정은 DB에서 직접 부여한다.
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, name, role: "user" })
    .returning({ id: users.id, email: users.email, role: users.role });

  const token = await signSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  setSessionCookie(token);

  return NextResponse.json({ id: user.id, email: user.email, role: user.role });
}
