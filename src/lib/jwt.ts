import { SignJWT, jwtVerify } from "jose";

// Edge Runtime(미들웨어)에서도 안전하게 임포트할 수 있도록 JWT 서명/검증만 분리한 모듈.
// bcrypt 기반 비밀번호 해싱은 lib/auth.ts에 있으며, Node.js 전용 API를 사용하므로
// 미들웨어에서는 절대 임포트하면 안 된다.

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set");
}

const secretKey = new TextEncoder().encode(JWT_SECRET);

export type SessionPayload = {
  userId: number;
  email: string;
  role: "admin" | "user";
};

export async function signSessionToken(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(secretKey);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (
      typeof payload.userId !== "number" ||
      typeof payload.email !== "string" ||
      (payload.role !== "admin" && payload.role !== "user")
    ) {
      return null;
    }
    return { userId: payload.userId, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
