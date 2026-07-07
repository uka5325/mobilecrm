import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/api/reservations-consistent";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/api/reservations",
};
