import { NextRequest, NextResponse } from "next/server";
import { reconcileDirtyPatientBatch } from "@/lib/patientSummary";

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
    const result = await reconcileDirtyPatientBatch({ limit: 5 });
    return NextResponse.json(
      { success: true, ...result },
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
