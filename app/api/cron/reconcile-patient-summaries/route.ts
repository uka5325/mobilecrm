import { NextRequest, NextResponse } from "next/server";
import { reconcileDirtyPatientBatch } from "@/features/patients/jobs/summary/patientSummaryDirty";
import { runStorageCleanupBatch } from "@/features/photos/jobs/storageCleanupWorker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    // 무료 운영을 위해 Vercel Cron 호출은 하나만 유지하고 독립 worker를 함께 실행한다.
    const [result, storageCleanup] = await Promise.all([
      reconcileDirtyPatientBatch({ limit: 5 }),
      runStorageCleanupBatch({ limit: 5 }),
    ]);
    return NextResponse.json(
      { success: true, ...result, storageCleanup },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "[/api/cron/reconcile-patient-summaries]",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json(
      { success: false, message: "Summary reconcile failed" },
      { status: 500 }
    );
  }
}
