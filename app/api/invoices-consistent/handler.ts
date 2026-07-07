import { NextRequest, NextResponse } from "next/server";
import { POST as legacyPost } from "../invoices/route";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createInvoiceAtomic,
  deleteInvoiceAtomic,
  updateInvoiceAtomic,
} from "@/lib/invoiceConsistencyServer";

type Body = {
  idToken?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

export async function handleInvoiceRequest(req: NextRequest) {
  const legacyRequest = req.clone();
  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json(
      { success: false, message: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const action = String(body.action || "");
  if (action !== "create" && action !== "update" && action !== "delete") {
    return legacyPost(legacyRequest);
  }

  try {
    const staff = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
    const payload = body.payload || {};
    if (action === "create") return createInvoiceAtomic(payload, staff);
    if (action === "update") return updateInvoiceAtomic(payload, staff);
    return deleteInvoiceAtomic(payload, staff);
  } catch (error) {
    const authResponse = toAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[/api/invoices-consistent]", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
