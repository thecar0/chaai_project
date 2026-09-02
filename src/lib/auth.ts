import bcrypt from "bcryptjs";

// Node.js 전용(bcrypt) 비밀번호 해싱. Edge Runtime에서 실행되는 미들웨어에서는
// 절대 임포트하지 말 것 — JWT 검증만 필요하면 lib/jwt.ts를 사용한다.

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
