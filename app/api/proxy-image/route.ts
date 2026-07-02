import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";

export async function GET(req: NextRequest) {
  // 활성 직원만 프록시 허용 (오픈 프록시 방지)
  const authHeader = req.headers.get("authorization");
  try {
    await requireActiveStaff(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
  } catch (authErr) {
    const res = toAuthErrorResponse(authErr);
    if (res) return res;
    throw authErr;
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  // Firebase Storage URL 검증: 호스트 + 우리 bucket + reservationFiles/ 경로만 프록시.
  // (호스트 접두만 보던 걸 강화 — 임의 객체/타 버킷 프록시 방지)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.hostname !== "firebasestorage.googleapis.com") {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  // 경로 형식: /v0/b/<bucket>/o/<url-encoded-object-path>
  const m = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!m) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const bucket = decodeURIComponent(m[1]);
  const objectPath = decodeURIComponent(m[2]);
  const allowedBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "";
  if (allowedBucket && bucket !== allowedBucket) {
    return NextResponse.json({ error: "invalid bucket" }, { status: 400 });
  }
  if (!objectPath.startsWith("reservationFiles/")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return NextResponse.json({ error: "upstream error" }, { status: upstream.status });
    }
    const contentLength = upstream.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "파일이 너무 큽니다. (최대 20MB)" }, { status: 413 });
    }
    const blob = await upstream.blob();
    return new NextResponse(blob, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
