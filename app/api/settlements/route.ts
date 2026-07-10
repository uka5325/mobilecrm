
import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createSettlementAtomic,
  listSettlements,
  updateSettlementAtomic,
  voidSettlementAtomic,
} from "@/lib/settlementServer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      idToken?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    const ctx = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
    const payload = body.payload || {};
    if (body.action === "list") return listSettlements(payload);
    if (body.action === "create") return createSettlementAtomic(payload, ctx);
    if (body.action === "update") return updateSettlementAtomic(payload, ctx);
    if (body.action === "void") return voidSettlementAtomic(payload, ctx);
    return NextResponse.json(
      { success: false, code: "UNKNOWN_ACTION", message: "지원하지 않는 정산 요청입니다." },
      { status: 400 }
    );
  } catch (error) {
    const authResponse = toAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[/api/settlements]", error);
    return NextResponse.json(
      { success: false, code: "INTERNAL_ERROR", message: "정산 처리 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
