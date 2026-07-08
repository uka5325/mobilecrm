import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeJobId(storagePath: string): string {
  return createHash("sha256").update(storagePath).digest("hex");
}

function isAllowedStoragePath(storagePath: string): boolean {
  return storagePath.startsWith("reservationFiles/")
    && storagePath.length <= 500
    && !storagePath.includes("../");
}

function storageErrorCode(error: unknown): number | string {
  const code = (error as { code?: number | string })?.code;
  return code ?? "unknown";
}

export async function POST(req: NextRequest) {
  let body: { idToken?: string; storagePath?: string };
  try {
    body = await req.json() as { idToken?: string; storagePath?: string };
  } catch {
    return NextResponse.json(
      { success: false, message: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  try {
    const ctx = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
    const storagePath = String(body.storagePath || "").trim();
    if (!isAllowedStoragePath(storagePath)) {
      return NextResponse.json(
        { success: false, message: "허용되지 않은 Storage 경로입니다." },
        { status: 400 }
      );
    }

    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "";
    let lastError = "storage bucket is not configured";

    if (bucketName) {
      const file = adminStorage.bucket(bucketName).file(storagePath);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await file.delete();
          return NextResponse.json({ success: true, deleted: true, queued: false });
        } catch (error) {
          const code = storageErrorCode(error);
          // 이미 삭제됐거나 존재하지 않는 파일은 보상 삭제가 완료된 것으로 처리한다.
          if (code === 404 || code === "404") {
            return NextResponse.json({ success: true, deleted: true, queued: false });
          }
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt < 3) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, attempt * 150);
            });
          }
        }
      }
    }

    // 즉시 삭제가 끝내 실패해도 유실되지 않도록 서버 전용 정리 job을 남긴다.
    const jobId = safeJobId(storagePath);
    const jobRef = adminDb.collection("storageCleanupJobs").doc(jobId);
    const existingJob = await jobRef.get();
    await jobRef.set({
      storagePath,
      status: "pending",
      reason: "photo_record_write_failed",
      attempts: FieldValue.increment(1),
      lastError: lastError.slice(0, 500),
      requestedByUid: ctx.uid,
      requestedByName: ctx.name,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existingJob.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });

    return NextResponse.json(
      { success: true, deleted: false, queued: true },
      { status: 202 }
    );
  } catch (error) {
    const authResponse = toAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[/api/storage-cleanup]", error);
    return NextResponse.json(
      { success: false, message: "사진 원본 정리 요청에 실패했습니다." },
      { status: 500 }
    );
  }
}
