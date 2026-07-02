import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/signin") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/register");

  if (!req.auth && !isPublic) {
    return NextResponse.redirect(new URL("/signin", req.nextUrl));
  }
  return NextResponse.next();
});

// run middleware on everything except static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};