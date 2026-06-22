import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  // Only proxy Firebase Storage URLs
  if (!url.startsWith("https://firebasestorage.googleapis.com/")) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
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
