import { getOrder } from "@/lib/data/orders";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { updateOrderForUser } from "@/lib/orders/edit";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { mobileAction, readJson } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return mobileError("errors.notFound", 404);
  const [eInvoice] = await db
    .select({
      id: einvoices.id,
      status: einvoices.status,
      number: einvoices.number,
      serial: einvoices.serial,
      provider: einvoices.provider,
      providerReference: einvoices.providerReference,
      requestId: einvoices.requestId,
      attemptCount: einvoices.attemptCount,
      lastAttemptAt: einvoices.lastAttemptAt,
      nextAttemptAt: einvoices.nextAttemptAt,
      lastError: einvoices.lastError,
      issuedAt: einvoices.issuedAt,
    })
    .from(einvoices)
    .where(eq(einvoices.orderId, id))
    .limit(1);
  return mobileOk({
    ...order,
    eInvoice: eInvoice ?? null,
    lifecycle: {
      hasReturns: order.returns.length > 0,
      hasEInvoice: eInvoice?.status === "issued",
      canEdit:
        (order.status === "completed" || order.status === "quote") &&
        order.returns.length === 0 &&
        eInvoice?.status !== "issued",
      canCancel: order.status !== "cancelled" && order.status !== "merged" && eInvoice?.status !== "issued",
      canAddPayment:
        (order.status === "completed" || order.status === "returned") &&
        Number(order.amountPaid) < Number(order.total),
      canConvertQuote: order.status === "quote",
      canCancelQuote: order.status === "quote",
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await updateOrderForUser(gate.userId, {
      ...(body as Record<string, unknown>),
      orderId: id,
    } as Parameters<typeof updateOrderForUser>[1])
  );
}
