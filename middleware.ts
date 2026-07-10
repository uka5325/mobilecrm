import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (req.nextUrl.pathname === "/api/reservations") {
    url.pathname = "/api/reservations-consistent";
  } else if (req.nextUrl.pathname === "/api/invoices") {
    url.pathname = "/api/invoices-consistent";
  }
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/api/reservations", "/api/invoices"],
};
