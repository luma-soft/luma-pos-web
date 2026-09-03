import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, einvoices, zaloMessageEvents } from "@/db/schema";
import { formatCurrency } from "@/lib/utils";
import { getOrder } from "@/lib/data/orders";
import { getZaloConfig } from "./config";
import { sendOaTextMessage, sendZnsTemplate } from "./client";
import { recordActivity } from "@/lib/audit/activity-log";

export type ZaloSendKind = "portal_link" | "invoice";

export type ZaloSendInput =
  | { kind: "portal_link"; storeId: string; customerId: string; url: string; actorId?: string | null }
  | { kind: "invoice"; storeId: string; orderId: string; url?: string; actorId?: string | null };

type ZaloSendPrepared = {
  kind: ZaloSendKind;
  customerId?: string | null;
  orderId?: string | null;
  invoiceId?: string | null;
  phone: string;
  zaloUserId?: string | null;
  templateId: string;
  templateData: Record<string, string | number>;
  oaText: string;
  payloadSummary: Record<string, unknown>;
};

function normalizePhone(phone: string | null | undefined) {
  return (phone ?? "").replace(/[^\d+]/g, "");
}

async function logZaloEvent(input: ZaloSendPrepared, status: string, details: {
  zaloMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}, storeId: string, actorId?: string | null) {
  await db.transaction(async (tx) => {
    await tx.insert(zaloMessageEvents).values({
      storeId,
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
    if (status === "sent") {
      await recordActivity(tx, {
        storeId, actorId: actorId ?? null,
        action: input.kind === "invoice" ? "zalo.invoice.sent" : "zalo.portal_link.sent",
        entityType: input.orderId ? "order" : "customer", entityId: input.orderId ?? input.customerId,
        after: { code: input.payloadSummary.orderCode, name: input.payloadSummary.customerName, status: "sent" },
      });
    }
  });
}

async function preparePortalLink(input: Extract<ZaloSendInput, { kind: "portal_link" }>, templateId: string): Promise<ZaloSendPrepared | { error: string }> {
  const [customer] = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, zaloUserId: customers.zaloUserId })
    .from(customers)
    .where(and(eq(customers.storeId, input.storeId), eq(customers.id, input.customerId)))
    .limit(1);
  if (!customer) return { error: "errors.notFound" };
  const phone = normalizePhone(customer.phone);
  return {
    kind: "portal_link",
    customerId: customer.id,
    phone,
    zaloUserId: customer.zaloUserId,
    templateId,
    templateData: {
      customer_name: customer.name,
      portal_url: input.url,
    },
    oaText: `Chào ${customer.name}, LumaPOS gửi link đặt hàng của bạn: ${input.url}`,
    payloadSummary: {
      customerName: customer.name,
      url: input.url,
    },
  };
}

async function prepareInvoice(input: Extract<ZaloSendInput, { kind: "invoice" }>, templateId: string): Promise<ZaloSendPrepared | { error: string }> {
  const order = await getOrder(input.storeId, input.orderId);
  if (!order) return { error: "errors.notFound" };
  const phone = normalizePhone(order.customerPhone);
  if (!order.customerId) return { error: "zalo.errors.missingPhone" };
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
    zaloUserId: order.customerZaloUserId,
    templateId,
    templateData: {
      customer_name: order.customerName ?? "Khach le",
      order_code: order.code,
      order_total: formatCurrency(Number(order.total)),
      order_url: input.url ?? "",
      invoice_number: invoice?.number ?? order.code,
    },
    oaText: [
      `Chào ${order.customerName ?? "quý khách"}, LumaPOS gửi hóa đơn/đơn hàng ${order.code}.`,
      `Tổng tiền: ${formatCurrency(Number(order.total))}.`,
      input.url ? `Xem chi tiết: ${input.url}` : "",
    ].filter(Boolean).join("\n"),
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
  const config = await getZaloConfig(input.storeId);
  if (!config.enabled) return { ok: false as const, error: "zalo.errors.notEnabled" };
  if (!config.accessToken) return { ok: false as const, error: "zalo.errors.missingAccessToken" };
  const templateId = input.kind === "portal_link" ? config.portalTemplateId : config.invoiceTemplateId;
  if (config.deliveryMode === "zns" && !templateId) return { ok: false as const, error: "zalo.errors.missingTemplate" };

  const prepared = input.kind === "portal_link"
    ? await preparePortalLink(input, templateId)
    : await prepareInvoice(input, templateId);
  if ("error" in prepared) return { ok: false as const, error: prepared.error };
  if (config.deliveryMode === "zns" && !prepared.phone) return { ok: false as const, error: "zalo.errors.missingPhone" };

  const result = config.deliveryMode === "oa"
    ? prepared.zaloUserId
      ? await sendOaTextMessage(config.accessToken, {
        recipient: { user_id: prepared.zaloUserId },
        message: { text: prepared.oaText },
      })
      : { ok: false as const, errorCode: "missing_zalo_user_id", errorMessage: "zalo.errors.missingZaloUserId" }
    : await sendZnsTemplate(config.accessToken, {
      phone: prepared.phone,
      template_id: prepared.templateId,
      template_data: prepared.templateData,
      tracking_id: `${prepared.kind}:${prepared.orderId ?? prepared.customerId ?? Date.now()}`,
    });
  if (result.ok) {
    await logZaloEvent(prepared, "sent", { zaloMessageId: result.messageId }, input.storeId, input.actorId);
    return { ok: true as const, data: { messageId: result.messageId } };
  }
  await logZaloEvent(prepared, "failed", {
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  }, input.storeId, input.actorId);
  if (result.errorCode === "missing_zalo_user_id") return { ok: false as const, error: "zalo.errors.missingZaloUserId" };
  return { ok: false as const, error: "zalo.errors.sendFailed" };
}
