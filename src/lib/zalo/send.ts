import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, einvoices, zaloMessageEvents } from "@/db/schema";
import { formatCurrency } from "@/lib/utils";
import { getOrder } from "@/lib/data/orders";
import { getZaloConfig } from "./config";
import { sendZnsTemplate } from "./client";

export type ZaloSendKind = "portal_link" | "invoice";

export type ZaloSendInput =
  | { kind: "portal_link"; customerId: string; url: string; actorId?: string | null }
  | { kind: "invoice"; orderId: string; url?: string; actorId?: string | null };

type ZaloSendPrepared = {
  kind: ZaloSendKind;
  customerId?: string | null;
  orderId?: string | null;
  invoiceId?: string | null;
  phone: string;
  templateId: string;
  templateData: Record<string, string | number>;
  payloadSummary: Record<string, unknown>;
};

function normalizePhone(phone: string | null | undefined) {
  return (phone ?? "").replace(/[^\d+]/g, "");
}

async function logZaloEvent(input: ZaloSendPrepared, status: string, details: {
  zaloMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}, actorId?: string | null) {
  await db.insert(zaloMessageEvents).values({
    kind: input.kind,
    status,
    customerId: input.customerId ?? null,
    orderId: input.orderId ?? null,
    invoiceId: input.invoiceId ?? null,
    phone: input.phone,
    templateId: input.templateId,
    zaloMessageId: details.zaloMessageId ?? null,
    payloadSummary: input.payloadSummary,
    errorCode: details.errorCode ?? null,
    errorMessage: details.errorMessage?.slice(0, 500) ?? null,
    createdBy: actorId ?? null,
  });
}

async function preparePortalLink(input: Extract<ZaloSendInput, { kind: "portal_link" }>, templateId: string): Promise<ZaloSendPrepared | { error: string }> {
  const [customer] = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);
  if (!customer) return { error: "errors.notFound" };
  const phone = normalizePhone(customer.phone);
  if (!phone) return { error: "zalo.errors.missingPhone" };
  return {
    kind: "portal_link",
    customerId: customer.id,
    phone,
    templateId,
    templateData: {
      customer_name: customer.name,
      portal_url: input.url,
    },
    payloadSummary: {
      customerName: customer.name,
      url: input.url,
    },
  };
}

async function prepareInvoice(input: Extract<ZaloSendInput, { kind: "invoice" }>, templateId: string): Promise<ZaloSendPrepared | { error: string }> {
  const order = await getOrder(input.orderId);
  if (!order) return { error: "errors.notFound" };
  const phone = normalizePhone(order.customerPhone);
  if (!order.customerId || !phone) return { error: "zalo.errors.missingPhone" };
  const [invoice] = await db
    .select({ id: einvoices.id, number: einvoices.number, status: einvoices.status })
    .from(einvoices)
    .where(eq(einvoices.orderId, order.id))
    .limit(1);
  return {
    kind: "invoice",
    customerId: order.customerId,
    orderId: order.id,
    invoiceId: invoice?.id ?? null,
    phone,
    templateId,
    templateData: {
      customer_name: order.customerName ?? "Khach le",
      order_code: order.code,
      order_total: formatCurrency(Number(order.total)),
      order_url: input.url ?? "",
      invoice_number: invoice?.number ?? order.code,
    },
    payloadSummary: {
      customerName: order.customerName,
      orderCode: order.code,
      total: Number(order.total),
      url: input.url ?? "",
      invoiceNumber: invoice?.number ?? null,
    },
  };
}

export async function sendZaloMessage(input: ZaloSendInput) {
  const config = await getZaloConfig();
  if (!config.enabled) return { ok: false as const, error: "zalo.errors.notEnabled" };
  if (!config.accessToken) return { ok: false as const, error: "zalo.errors.missingAccessToken" };
  const templateId = input.kind === "portal_link" ? config.portalTemplateId : config.invoiceTemplateId;
  if (!templateId) return { ok: false as const, error: "zalo.errors.missingTemplate" };

  const prepared = input.kind === "portal_link"
    ? await preparePortalLink(input, templateId)
    : await prepareInvoice(input, templateId);
  if ("error" in prepared) return { ok: false as const, error: prepared.error };

  const result = await sendZnsTemplate(config.accessToken, {
    phone: prepared.phone,
    template_id: prepared.templateId,
    template_data: prepared.templateData,
    tracking_id: `${prepared.kind}:${prepared.orderId ?? prepared.customerId ?? Date.now()}`,
  });
  if (result.ok) {
    await logZaloEvent(prepared, "sent", { zaloMessageId: result.messageId }, input.actorId);
    return { ok: true as const, data: { messageId: result.messageId } };
  }
  await logZaloEvent(prepared, "failed", {
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  }, input.actorId);
  return { ok: false as const, error: "zalo.errors.sendFailed" };
}
