import { NextRequest, NextResponse } from "next/server";
import { requireActiveStaff, toAuthErrorResponse } from "@/lib/apiAuth";
import {
  createInvoiceAtomic,
  deleteInvoiceAtomic,
  updateInvoiceAtomic,
} from "@/lib/invoiceConsistencyServer";
import { createInvoiceAccess } from "./invoiceAccess";
import { handleInvoiceReadAction } from "./invoiceReadActions";

type InvoiceRequestBody = {
  idToken?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

const WRITE_ACTIONS = new Set(["create", "update", "delete"]);

export async function POST(req: NextRequest) {
  let body: InvoiceRequestBody;
  try {
    body = await req.json() as InvoiceRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const action = String(body.action || "");
  const payload = body.payload || {};

  try {
    const staff = await requireActiveStaff(body.idToken, {
      checkRevoked: WRITE_ACTIONS.has(action),
    });

    const readResponse = await handleInvoiceReadAction(
      action,
      payload,
      createInvoiceAccess(staff)
    );
    if (readResponse) return readResponse;

    if (action === "create") return createInvoiceAtomic(payload, staff);
    if (action === "update") return updateInvoiceAtomic(payload, staff);
    if (action === "delete") return deleteInvoiceAtomic(payload, staff);

    return NextResponse.json(
      { success: false, message: "알 수 없는 action" },
      { status: 400 }
    );
  } catch (error) {
    const authResponse = toAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[/api/invoices]", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "서버 오류" },
      { status: 500 }
    );
  }
}
