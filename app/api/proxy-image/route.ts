import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { adminStorage } from "@/lib/firebaseAdmin";

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

  // path(storagePath) 모드 — 다운로드 토큰 URL을 전혀 거치지 않고 Admin SDK(서비스 계정)로
  // 직접 스트리밍한다. Storage Rules의 다운로드 토큰 우회 한계(storage.rules 참고)를
  // 회피하는 유일한 방법 — 클라이언트는 storagePath만 알면 되고 토큰을 받지 않는다.
  const path = req.nextUrl.searchParams.get("path");
  if (path) {
    if (!path.startsWith("reservationFiles/")) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
    try {
      const bucket = adminStorage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined);
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
      const [metadata] = await file.getMetadata();
      if (metadata.size && Number(metadata.size) > 20 * 1024 * 1024) {
        return NextResponse.json({ error: "파일이 너무 큽니다. (최대 20MB)" }, { status: 413 });
      }
      const [buffer] = await file.download();
      return new NextResponse(new Blob([new Uint8Array(buffer)]), {
        headers: {
          "Content-Type": metadata.contentType ?? "application/octet-stream",
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // url(레거시 다운로드 토큰 URL) 모드 — path가 없는 구 레코드 폴백용으로 유지.
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
