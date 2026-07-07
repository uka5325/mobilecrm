import { NextRequest } from "next/server";
import { POST as legacyPost } from "../invoices/route";
import { requireActiveStaff } from "@/lib/apiAuth";
import { createInvoiceAtomic, deleteInvoiceAtomic, updateInvoiceAtomic } from "@/lib/invoiceConsistencyServer";

export async function handleInvoiceRequest(req: NextRequest) {
  const legacyRequest = req.clone();
  const body = await req.json() as {
    idToken?: string;
    action?: string;
    payload?: Record<string, unknown>;
  };
  const action = String(body.action || "");
  if (action !== "create" && action !== "update" && action !== "delete") {
    return legacyPost(legacyRequest);
  }
  const staff = await requireActiveStaff(String(body.idToken || ""), { checkRevoked: true });
  const payload = body.payload || {};
  if (action === "create") return createInvoiceAtomic(payload, staff);
  if (action === "update") return updateInvoiceAtomic(payload, staff);
  return deleteInvoiceAtomic(payload, staff);
}
