import type { StaffContext } from "@/lib/apiAuth";

export type InvoiceAccess = {
  isAdmin: boolean;
  callerUid: string;
  callerName: string;
  canAccess: (invoice: Record<string, unknown>) => boolean;
};

export function createInvoiceAccess(ctx: StaffContext): InvoiceAccess {
  const isAdmin = ctx.role === "admin";

  return {
    isAdmin,
    callerUid: ctx.uid,
    callerName: ctx.name,
    canAccess(invoice) {
      if (isAdmin) return true;
      const uids = Array.isArray(invoice.coordinatorUids) ? invoice.coordinatorUids as string[] : [];
      if (uids.length) return uids.includes(ctx.uid);
      const coordinators = Array.isArray(invoice.coordinators) ? invoice.coordinators as string[] : [];
      return ctx.name ? coordinators.includes(ctx.name) : false;
    },
  };
}
