import { Routes } from "@/lib/routes";
import type { getAuditLogs } from "@/lib/audit";

export type ActivityRecord = {
  id: string | null;
  type: string;
  code: string | null;
  name: string | null;
  context?: string | null;
  href?: string | null;
};

export type NotificationActivity = Awaited<ReturnType<typeof getAuditLogs>>[number] & {
  resolvedEntity?: ActivityRecord | null;
};

export function activityObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function activityText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function readableText(value: unknown) {
  const text = activityText(value);
  return text && !uuid.test(text) ? text : null;
}

export function activityRecordLabel(record: ActivityRecord) {
  return [...new Set([readableText(record.code), readableText(record.name)].filter(Boolean))].join(" · ");
}

export function activityRecordHref(record: ActivityRecord) {
  if (record.href?.startsWith("/") && !record.href.startsWith("//") && !record.href.includes("\\")) return record.href;
  if (!record.id || record.id === "draft") return null;
  const id = encodeURIComponent(record.id);
  switch (record.type) {
    case "product": case "product_price": return Routes.product(record.id);
    case "customer": return `/partners?tab=customers&expandedCustomer=${id}`;
    case "supplier": return `/partners?tab=suppliers&expanded=${id}`;
    case "quote": return Routes.salesOrder(record.id, "quote");
    case "order": case "invoice": return Routes.salesOrder(record.id, "completed");
    case "purchase_order": case "purchase": case "inbound": return Routes.purchase(id);
    case "project": case "service_project": return Routes.project(record.id);
    case "pos_cart_draft": return "/pos";
    case "cashbook": case "cash_transaction": return "/finance?tab=cashbook";
    default: return null;
  }
}

export function activityRelatedRecords(row: NotificationActivity): ActivityRecord[] {
  const records = Array.isArray(row.affectedRecords) ? row.affectedRecords : [];
  return records.map((value) => {
    const record = activityObject(value);
    return {
      id: activityText(record.id) ?? activityText(record.entityId),
      type: activityText(record.type) ?? activityText(record.entityType) ?? row.entityType,
      code: readableText(record.code) ?? readableText(record.sku),
      name: readableText(record.name) ?? readableText(record.label),
      href: activityText(record.href),
    };
  });
}

export function activityEntity(row: NotificationActivity): ActivityRecord | null {
  const after = activityObject(row.after);
  const before = activityObject(row.before);
  const related = activityRelatedRecords(row).find((record) => record.id === row.entityId);
  // Preserve historical names/codes when recorded, resolving current records only as a fallback.
  const record: ActivityRecord = {
    id: row.entityId,
    type: row.entityType,
    code: readableText(after.code) ?? readableText(after.sku) ?? related?.code ?? readableText(before.code) ?? readableText(before.sku) ?? row.resolvedEntity?.code ?? null,
    name: readableText(after.name) ?? readableText(after.title) ?? related?.name ?? readableText(before.name) ?? row.resolvedEntity?.name ?? null,
    ...((row.resolvedEntity?.type === "service_job") ? row.resolvedEntity : {}),
  };
  return activityRecordLabel(record) ? record : null;
}

export function activityPrompt(value: string | null) {
  if (!value) return null;
  const prompt = value.replace(/\[AI_ACTION_PRESET:[a-z_]+\]\s*/g, "");
  const userInput = prompt.match(/(?:Thông tin người dùng|User information):\s*([\s\S]*)$/i)?.[1] ?? prompt;
  return userInput.replace(/\[\d+ attachment\(s\)[^\]]*\]/g, "").trim() || null;
}

export function activityActionKey(action: string) {
  return action.replaceAll(".", "_");
}
