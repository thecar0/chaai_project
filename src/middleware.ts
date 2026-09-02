import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/jwt";
import { SESSION_COOKIE } from "@/lib/session";

const PROTECTED_PREFIXES = ["/buildings", "/calendar", "/admin"];
const ADMIN_PREFIXES = ["/admin"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAdminRoute = ADMIN_PREFIXES.some((p) => pathname.startsWith(p));
  if (isAdminRoute && session.role !== "admin") {
    return NextResponse.redirect(new URL("/buildings", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/buildings/:path*", "/calendar/:path*", "/admin/:path*"],
};
