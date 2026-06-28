import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, customers, orders, priceBooks, productPrices, products, suppliers, warehouses } from "@/db/schema";
import type { RestockRow } from "@/lib/data/ai-restock";
import type { ParsedAiAttachment } from "@/lib/ai/attachments";
import { planAiAssistantIntent, type AiPlannerIntent, type AiPlannerResult } from "@/lib/ai/planner";
import { recordAiTokenUsage } from "@/lib/ai/usage";

export type AiAssistantState =
  | "idle"
  | "parsing"
  | "needs_input"
  | "needs_selection"
  | "preview"
  | "confirming"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unauthorized";

export type AiActionLine = {
  label: string;
  value: string;
  meta?: string;
  tone?: "default" | "warning" | "danger" | "success";
};

export type AiActionPreview = {
  id: string;
  intent: string;
  title: string;
  description: string;
  confidence: number;
  state: AiAssistantState;
  confirmationRequired: boolean;
  strongConfirmation?: boolean;
  entityType: string;
  entityId?: string | null;
  requiredFields: string[];
  missingFields: string[];
  fields: AiActionLine[];
  lines: AiActionLine[];
  warnings: string[];
  selections?: Array<{
    type: string;
    query: string;
    candidates: { id?: string; label: string; code?: string; confidence?: number }[];
  }>;
  reviewAction?: {
    type: "open";
    href: string;
    label: string;
    target: string;
  };
  action: {
    type: string;
    target: string;
    payload: Record<string, unknown>;
  };
};

export type AiAssistantResponse = {
  text: string;
  state: AiAssistantState;
  prompt: string;
  actionPreview?: AiActionPreview;
  actions: Array<{ type: string; target: string; label: string }>;
  chart?: { type: string; rows: unknown[] };
  toolTrace?: AiToolTrace[];
};

const PLANNER_CONFIDENCE_THRESHOLD = 0.55;
const AI_TOOL_LOOP_MAX_DEPTH = 2;

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function previewProductIds(preview: AiActionPreview) {
  const items = Array.isArray(preview.action.payload.items) ? preview.action.payload.items : [];
  return [...new Set(items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const id = stringValue((item as Record<string, unknown>).productId);
    return id ? [id] : [];
  }))];
}

function queryValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hrefWithParams(path: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function posAiDraftHref(preview: AiActionPreview) {
  const ids = previewProductIds(preview);
  const params = new URLSearchParams({ aiDraft: "1", source: "ai-preview" });
  if (ids.length) params.set("aiProducts", ids.join(","));
  return `/pos?${params.toString()}`;
}

function buildAiReviewAction(preview: AiActionPreview): AiActionPreview["reviewAction"] {
  const payload = preview.action.payload;
  const orderId = stringValue(payload.orderId) ?? stringValue(preview.entityId);
  const orderCode = stringValue(payload.orderCode);
  const productId = stringValue(payload.productId) ?? stringValue(preview.entityId);
  const productQuery = stringValue(payload.sku) ?? stringValue(payload.productName) ?? queryValue(payload.prompt);
  const reportCustomerId = stringValue(payload.customerId);
  const reportCustomer = stringValue(payload.customerName) ?? queryValue(payload.customerQuery);
  const reportQuery = queryValue(payload.query) || queryValue(payload.prompt);

  if (preview.intent === "create_inventory_inbound") {
    return { type: "open", href: "/purchases/new?source=ai-preview", label: "Mở trang tạo phiếu nhập", target: "purchase_new" };
  }
  if (preview.intent === "create_draft_purchase_order" || preview.intent === "create_draft_purchase_order_from_restocking") {
    return { type: "open", href: "/purchases/new?mode=draft&source=ai-preview", label: "Mở trang tạo PO nháp", target: "purchase_new" };
  }
  if (preview.intent === "create_order" && preview.entityType === "quote") {
    return { type: "open", href: posAiDraftHref(preview), label: "Mở POS tạo báo giá", target: "quotes" };
  }
  if (preview.intent === "create_order") {
    return { type: "open", href: posAiDraftHref(preview), label: "Mở POS kiểm tra hóa đơn", target: "pos" };
  }
  if (preview.intent === "pos_voice_cart_draft" || preview.intent === "pos_image_cart_draft") {
    return { type: "open", href: "/pos?aiDraft=1", label: "Mở POS kiểm tra giỏ nháp", target: "pos" };
  }
  if (preview.intent === "convert_quote_to_order") {
    return { type: "open", href: orderId ? `/sales?tab=quotes&orderId=${orderId}&expandedOrder=${orderId}` : "/sales?tab=quotes", label: "Mở báo giá liên quan", target: "quotes" };
  }
  if (preview.intent === "find_invoice" || preview.intent === "edit_invoice" || preview.intent === "record_invoice_payment" || preview.intent === "cancel_invoice" || preview.intent === "create_return_refund" || preview.intent === "send_einvoice") {
    return {
      type: "open",
      href: orderId
        ? `/sales?tab=orders&orderId=${orderId}&expandedOrder=${orderId}`
        : hrefWithParams("/sales", { tab: "orders", q: orderCode || reportQuery || undefined, source: "ai-preview" }),
      label: "Mở hóa đơn liên quan",
      target: "orders",
    };
  }
  if (preview.intent === "set_product_price" || preview.intent === "apply_price_formula") {
    return { type: "open", href: "/inventory?tab=pricing&source=ai-preview", label: "Mở bảng giá", target: "pricing" };
  }
  if (preview.intent === "create_product") {
    return { type: "open", href: "/products/new?source=ai-preview", label: "Mở form sản phẩm", target: "product_form" };
  }
  if (preview.intent === "update_product" || preview.intent === "update_product_min_stock") {
    return {
      type: "open",
      href: productId
        ? `/products/${productId}/edit?source=ai-preview`
        : hrefWithParams("/inventory", { tab: "products", q: productQuery, source: "ai-preview" }),
      label: "Mở form sản phẩm",
      target: "product_form",
    };
  }
  if (preview.intent === "create_product_category" || preview.intent === "create_product_brand") {
    return { type: "open", href: "/inventory?tab=products&source=ai-preview", label: "Mở màn sản phẩm", target: "products" };
  }
  if (preview.intent === "create_customer") {
    return { type: "open", href: "/customers/new?source=ai-preview", label: "Mở form khách hàng", target: "customers" };
  }
  if (preview.intent === "update_customer") {
    return { type: "open", href: "/partners?tab=customers&source=ai-preview", label: "Mở khách hàng", target: "customers" };
  }
  if (preview.intent === "create_cashbook_entry") {
    return { type: "open", href: "/finance?tab=cashbook&source=ai-preview", label: "Mở sổ quỹ", target: "cashbook" };
  }
  if (preview.intent === "inventory_stock_view") {
    return { type: "open", href: hrefWithParams("/inventory", { tab: "stock", q: productQuery || reportQuery, source: "ai-preview" }), label: "Mở tồn kho", target: "inventory" };
  }
  if (preview.intent === "create_stocktake") {
    return { type: "open", href: "/stocktakes/new?source=ai-preview", label: "Mở phiếu kiểm kho", target: "stocktakes" };
  }
  if (preview.intent === "customer_report") {
    return {
      type: "open",
      href: hrefWithParams("/reports", { source: "ai-preview", customerId: reportCustomerId, customer: reportCustomer, q: reportCustomerId ? undefined : reportQuery }),
      label: "Mở báo cáo theo khách",
      target: "reports",
    };
  }
  if (preview.intent === "report_summary") {
    return { type: "open", href: hrefWithParams("/reports", { source: "ai-preview", q: reportQuery }), label: "Mở báo cáo", target: "reports" };
  }
  return { type: "open", href: "/reports?source=ai-preview", label: "Mở báo cáo", target: "reports" };
}

function previewReviewAction(preview: AiActionPreview): AiActionPreview["reviewAction"] {
  return buildAiReviewAction(preview);
}

export function withAiPreviewReviewAction(preview: AiActionPreview): AiActionPreview {
  return { ...preview, reviewAction: preview.reviewAction ?? previewReviewAction(preview) };
}

export type AiToolTrace = {
  depth: number;
  tool: string;
  mutation: false;
  status: "succeeded" | "failed";
  durationMs: number;
  argsSummary?: Record<string, unknown>;
  result: {
    state?: AiAssistantState;
    intent?: string;
    entityType?: string;
    lineCount?: number;
    warningCount?: number;
  };
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

export function isAiReportSummaryPrompt(prompt: string) {
  const q = normalize(prompt);
  return (
    q.includes("bao cao") ||
    q.includes("report") ||
    q.includes("doanh thu") ||
    q.includes("da thu") ||
    q.includes("hom nay") ||
    q.includes("thang nay") ||
    q.includes("30 ngay") ||
    q.includes("ban duoc") ||
    q.includes("ban chay") ||
    q.includes("top seller") ||
    q.includes("top san pham") ||
    q.includes("loi nhuan") ||
    q.includes("khach") ||
    q.includes("ton kho") ||
    q.includes("kiem ton") ||
    q.includes("kiem kho") ||
    q.includes("mat hang")
  );
}

export function buildGeneralAssistantResponse(input: {
  prompt: string;
  suggestedNextQuestion?: string;
  toolTrace?: AiToolTrace[];
}): AiAssistantResponse {
  const nextQuestion = input.suggestedNextQuestion?.trim();
  return {
    text:
      "Đúng, đây là AI Assistant của LumaPOS. " +
      "Mình có thể hỗ trợ phân tích thông tin bán hàng, tồn kho và gợi ý vận hành khi nhà cung cấp AI phản hồi được. " +
      (nextQuestion || "Bạn muốn mình hỗ trợ tác vụ nào?"),
    state: "succeeded",
    prompt: input.prompt,
    actions: [],
    toolTrace: input.toolTrace ?? [],
  };
}

function moneyText(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

function mergePlannerGuidance(preview: AiActionPreview, plan: AiPlannerResult | null): AiActionPreview {
  if (!plan) return preview;
  const missingFields = Array.from(new Set([...preview.missingFields, ...plan.missingFields.filter(Boolean)]));
  const ambiguousWarnings = plan.ambiguousEntities.map((item) => {
    const labels = item.candidates.slice(0, 3).map((candidate) => candidate.label).join(", ");
    return labels
      ? `Cần chọn ${item.type} cho "${item.query}": ${labels}.`
      : `Cần chọn ${item.type}${item.query ? ` cho "${item.query}"` : ""}.`;
  });
  const warnings = Array.from(new Set([...preview.warnings, ...plan.warnings, ...ambiguousWarnings]));
  const hasAmbiguity = plan.ambiguousEntities.length > 0;
  const state: AiAssistantState =
    hasAmbiguity ? "needs_selection"
    : missingFields.length > 0 && preview.state === "preview" ? "needs_input"
    : preview.state;
  return {
    ...preview,
    state,
    missingFields,
    requiredFields: Array.from(new Set([...preview.requiredFields, ...missingFields])),
    warnings,
    selections: plan.ambiguousEntities.length ? plan.ambiguousEntities : preview.selections,
    confidence: Math.min(preview.confidence, plan.confidence),
  };
}

type InboundProductOption = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  costPrice: unknown;
  lastPurchasePrice: unknown;
  retailPrice: unknown;
};

type PriceProductOption = InboundProductOption & {
  retailPrice: unknown;
};

type PriceBookOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

type CustomerOption = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  type: "retail" | "wholesale" | "contractor" | "agent";
  debtLimit: unknown;
  note: string | null;
};

type OrderOption = {
  id: string;
  code: string;
  name: string;
  status: string;
  paymentStatus: string;
  total: unknown;
  amountPaid: unknown;
  customerName: string | null;
};

type NamedOption = {
  id: string;
  name: string;
  code?: string | null;
  isDefault?: boolean;
};

type InboundContext = {
  products: InboundProductOption[];
  suppliers: NamedOption[];
  warehouses: NamedOption[];
};

async function getInboundContext(): Promise<InboundContext> {
  const [productRows, supplierRows, warehouseRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(300),
    db
      .select({ id: suppliers.id, name: suppliers.name, code: suppliers.code })
      .from(suppliers)
      .orderBy(asc(suppliers.name))
      .limit(200),
    db
      .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
      .from(warehouses)
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
      .limit(50),
  ]);
  return {
    products: productRows,
    suppliers: supplierRows,
    warehouses: warehouseRows,
  };
}

function parseQuantity(prompt: string) {
  const match = prompt.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseMoneyAmount(prompt: string) {
  const matches = [...prompt.matchAll(/(\d[\d.,]*)(?:\s*(k|nghin|ngàn|ngan|₫|d|đ|vnd))?/gi)];
  const last = matches.at(-1);
  if (!last) return null;
  const raw = last[1];
  const suffix = normalize(last[2] ?? "");
  const compact = raw.replace(/[.,]/g, "");
  const value = Number(compact);
  if (!Number.isFinite(value)) return null;
  return suffix === "k" || suffix === "nghin" || suffix === "ngan" ? value * 1000 : value;
}

function cleanName(value: string) {
  return value
    .replace(/[,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textAfter(prompt: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) return cleanName(match[1]);
  }
  return "";
}

function matchNamed<T extends { name: string; sku?: string; code?: string | null }>(
  prompt: string,
  options: T[],
): { match: T | null; ambiguous: T[]; confidence: number } {
  const q = normalize(prompt);
  const scored = options
    .map((option) => {
      const name = normalize(option.name);
      const sku = option.sku ? normalize(option.sku) : "";
      const code = option.code ? normalize(option.code) : "";
      const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
      const skuHit = sku ? (sku.length <= 2 ? tokens.includes(sku) : q.includes(sku)) : false;
      const codeHit = code ? (code.length <= 2 ? tokens.includes(code) : q.includes(code)) : false;
      const score =
        skuHit ? 100 :
        codeHit ? 95 :
        q.includes(name) ? 90 :
        name.split(/\s+/).filter((part) => part.length > 1 && q.includes(part)).length;
      return { option, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top) return { match: null, ambiguous: [], confidence: 0 };
  if (top.score < 2) return { match: null, ambiguous: scored.slice(0, 3).map((item) => item.option), confidence: 0.35 };
  if (second && second.score === top.score && top.score < 90) {
    return { match: null, ambiguous: scored.slice(0, 3).map((item) => item.option), confidence: 0.45 };
  }
  return { match: top.option, ambiguous: [], confidence: Math.min(0.95, top.score / 100 || 0.72) };
}

function defaultCost(product: InboundProductOption | null) {
  return Number(product?.lastPurchasePrice ?? product?.costPrice ?? 0);
}

type InboundAttachmentRow = {
  text: string;
  sku?: string | null;
  unitName?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  grossUnitCost?: number | null;
  discount?: number | null;
  discountRate?: number | null;
  lineTotal?: number | null;
  confidence: number;
};

function positiveNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMoneyToken(raw: string) {
  const compact = raw.replace(/[^\d]/g, "");
  const value = Number(compact);
  return Number.isFinite(value) ? value : null;
}

function parseInvoiceNumber(text: string) {
  const match = text.match(/(?:số|so)\s*[:#-]?\s*([A-Z]{1,6}\d{3,}[\w-]*)/i);
  return match?.[1] ?? "";
}

function attachmentText(parsedAttachments: ParsedAiAttachment[]) {
  return parsedAttachments.map((item) => item.extractedText).filter(Boolean).join("\n");
}

function supplierHintsFromAttachment(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => cleanName(line))
    .filter(Boolean);
  const hints: string[] = [];
  for (const line of lines.slice(0, 12)) {
    const q = normalize(line);
    if (
      q.includes("hoa don") ||
      q.includes("khach hang") ||
      q.includes("dia chi") ||
      q.includes("sdt") ||
      q.includes("stk") ||
      q.includes("ma so thue") ||
      q.includes("chuyen:")
    ) {
      continue;
    }
    if (q.includes("npp") || q.includes("nha phan phoi") || q.includes("cong ty")) {
      hints.push(line);
      continue;
    }
    const letters = line.replace(/[^A-Za-zÀ-ỹĐđ]/g, "");
    const uppercase = letters.replace(/[a-zà-ỹđ]/g, "");
    if (letters.length >= 6 && uppercase.length / letters.length > 0.65) {
      hints.push(line);
    }
  }
  return [...new Set(hints)].slice(0, 3);
}

function rowsFromAttachmentCandidates(parsedAttachments: ParsedAiAttachment[]) {
  return parsedAttachments.flatMap((attachment) =>
    attachment.candidates.map((candidate) => ({
      text: candidate.text,
      sku: candidate.sku,
      unitName: candidate.unitName,
      quantity: positiveNumber(candidate.quantity),
      unitCost: positiveNumber(candidate.unitCost),
      grossUnitCost: positiveNumber(candidate.grossUnitCost),
      discount: Number.isFinite(Number(candidate.discount)) ? Number(candidate.discount) : null,
      discountRate: positiveNumber(candidate.discountRate),
      lineTotal: positiveNumber(candidate.lineTotal),
      confidence: candidate.confidence,
    })).filter((row) => row.text || row.sku)
  );
}

function rowFromTextLine(line: string): InboundAttachmentRow | null {
  const skuMatch = line.match(/\b(SP\d{3,})\b/i);
  if (!skuMatch?.[1]) return null;
  const sku = skuMatch[1].toUpperCase();
  const afterSku = cleanName(line.slice((skuMatch.index ?? 0) + skuMatch[0].length));
  const moneyMatches = [...afterSku.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b/g)];
  const moneyValues = moneyMatches.map((match) => parseMoneyToken(match[0])).filter((value): value is number => value != null);
  const firstMoneyIndex = moneyMatches[0]?.index ?? afterSku.length;
  const beforeMoney = cleanName(afterSku.slice(0, firstMoneyIndex));
  const percent = afterSku.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const discountRate = percent ? Number(percent[1].replace(",", ".")) : null;
  const lineTotal = moneyValues.at(-1) ?? null;
  const unitCost = moneyValues.length >= 2 ? moneyValues.at(-2) ?? null : moneyValues.at(-1) ?? null;
  const grossUnitCost = moneyValues.length >= 3 ? moneyValues[0] : null;
  const qtyFromTotal = lineTotal && unitCost ? lineTotal / unitCost : null;
  const trailingQty = beforeMoney.match(/\b(\d+(?:[.,]\d+)?)\s*$/)?.[1];
  const quantity = positiveNumber(trailingQty?.replace(",", ".")) ?? (
    qtyFromTotal && Math.abs(qtyFromTotal - Math.round(qtyFromTotal)) < 0.01 ? Math.round(qtyFromTotal) : null
  );
  const unitName = beforeMoney
    .replace(/\b\d+(?:[.,]\d+)?\s*$/g, "")
    .split(/\s+/)
    .at(-1) ?? null;
  const text = cleanName(
    beforeMoney
      .replace(/\b\d+(?:[.,]\d+)?\s*$/g, "")
      .replace(unitName ? new RegExp(`${escapeRegExp(unitName)}$`, "i") : /$/g, "")
  ) || afterSku;

  return {
    text,
    sku,
    unitName,
    quantity,
    unitCost,
    grossUnitCost,
    discountRate,
    lineTotal,
    confidence: 0.78,
  };
}

function rowsFromAttachmentText(text: string) {
  return text
    .split(/\n+/)
    .map((line) => rowFromTextLine(line))
    .filter((row): row is InboundAttachmentRow => Boolean(row));
}

function inboundRowsFromAttachments(parsedAttachments: ParsedAiAttachment[]) {
  const fromCandidates = rowsFromAttachmentCandidates(parsedAttachments);
  if (fromCandidates.length > 0) return fromCandidates;
  return rowsFromAttachmentText(attachmentText(parsedAttachments));
}

function matchProductForInboundRow(row: InboundAttachmentRow, productOptions: InboundProductOption[]) {
  if (row.sku) {
    const bySku = productOptions.find((product) => normalize(product.sku) === normalize(row.sku ?? ""));
    if (bySku) return { product: bySku, confidence: Math.max(row.confidence, 0.95), ambiguous: [] as InboundProductOption[] };
    return { product: null, confidence: row.confidence, ambiguous: [] as InboundProductOption[] };
  }
  const match = matchNamed(row.text, productOptions);
  return { product: match.match, confidence: Math.min(row.confidence, match.confidence), ambiguous: match.ambiguous };
}

async function inboundPreviewFromAttachments(
  prompt: string,
  context: InboundContext,
  parsedAttachments: ParsedAiAttachment[],
): Promise<AiActionPreview | null> {
  const rows = inboundRowsFromAttachments(parsedAttachments);
  if (rows.length === 0) return null;

  const text = attachmentText(parsedAttachments);
  const supplierHints = supplierHintsFromAttachment(text);
  const supplierMatch = supplierHints.length ? matchNamed(supplierHints.join(" "), context.suppliers) : { match: null, ambiguous: [], confidence: 0 };
  const warehouseMatch = matchNamed(prompt, context.warehouses);
  const warehouse = warehouseMatch.match ?? context.warehouses.find((item) => item.isDefault) ?? context.warehouses[0] ?? null;
  const supplier = supplierMatch.match;
  const invoiceNumber = parseInvoiceNumber(text);

  const matchedRows = rows.map((row) => {
    const match = matchProductForInboundRow(row, context.products);
    const product = match.product;
    const quantity = row.quantity ?? (row.lineTotal && row.unitCost ? row.lineTotal / row.unitCost : null);
    const usesNetUnitCost = row.unitCost != null;
    const unitCost = row.unitCost ?? row.grossUnitCost ?? defaultCost(product);
    const discount = usesNetUnitCost ? 0 : Math.max(0, row.discount ?? 0);
    return {
      row,
      product,
      quantity,
      unitCost,
      discount,
      confidence: match.confidence,
      ambiguous: match.ambiguous,
    };
  });

  const actionRows = matchedRows.filter((row) => row.product && row.quantity && row.quantity > 0);
  const unresolvedRows = matchedRows.filter((row) => !row.product || !row.quantity || row.quantity <= 0 || row.ambiguous.length > 0);
  const subtotal = actionRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity) * row.unitCost - row.discount), 0);
  const missingFields = [
    ...(supplier ? [] : ["supplier"]),
    ...(warehouse ? [] : ["warehouse"]),
    ...(actionRows.length > 0 ? [] : ["items"]),
    ...(unresolvedRows.length === 0 ? [] : ["unresolved_items"]),
  ];
  const canPreview = missingFields.length === 0;
  const supplierHint = supplierHints[0] ?? "";

  return {
    id: randomUUID(),
    intent: "create_inventory_inbound",
    title: "Xem trước phiếu nhập",
    description: canPreview
      ? `Tôi đọc được ${actionRows.length} dòng hàng từ ảnh phiếu nhập. Hãy kiểm tra trước khi xác nhận.`
      : "Tôi đã đọc ảnh phiếu nhập nhưng còn dòng hàng hoặc nhà cung cấp chưa match chắc chắn.",
    confidence: canPreview ? 0.86 : 0.58,
    state: canPreview ? "preview" : unresolvedRows.length > 0 ? "needs_selection" : "needs_input",
    confirmationRequired: true,
    strongConfirmation: true,
    entityType: "purchase_order",
    requiredFields: ["supplier", "warehouse", "items"],
    missingFields,
    fields: [
      { label: "Nhà cung cấp", value: supplier ? supplier.name : supplierHint ? `${supplierHint} (chưa match NCC)` : "Cần chọn", tone: supplier ? "success" : "warning" },
      { label: "Kho", value: warehouse ? warehouse.name : "Cần chọn", tone: warehouse ? (warehouseMatch.match ? "success" : "default") : "warning" },
      { label: "Số dòng hàng", value: `${actionRows.length}/${rows.length}`, tone: unresolvedRows.length ? "warning" : "success" },
      { label: "Tổng tạm tính", value: moneyText(subtotal), tone: subtotal > 0 ? "success" : "warning" },
      ...(invoiceNumber ? [{ label: "Số chứng từ", value: invoiceNumber }] : []),
    ],
    lines: matchedRows.map((row) => {
      const product = row.product;
      const quantity = row.quantity;
      const total = product && quantity ? Math.max(0, quantity * row.unitCost - row.discount) : 0;
      return {
        label: product?.name ?? row.row.text,
        value: product && quantity ? `+${quantity} ${product.baseUnit}` : "Cần chọn lại",
        meta: product
          ? `${product.sku} · ${moneyText(row.unitCost)} · ${moneyText(total)}`
          : [row.row.sku, row.row.unitName, row.row.lineTotal ? moneyText(row.row.lineTotal) : ""].filter(Boolean).join(" · "),
        tone: product && quantity && row.ambiguous.length === 0 ? "success" : "warning",
      };
    }),
    warnings: [
      "Nhập hàng thật sẽ tăng tồn kho và có thể cập nhật giá vốn.",
      ...(supplier ? [] : [`NCC đọc từ ảnh${supplierHint ? ` (${supplierHint})` : ""} chưa match được với danh sách nhà cung cấp.`]),
      ...unresolvedRows.map((row) => `Cần kiểm tra dòng: ${row.row.sku ? `${row.row.sku} · ` : ""}${row.row.text}`),
    ],
    action: {
      type: "create_inventory_inbound",
      target: "inventoryInbound",
      payload: {
        prompt,
        source: "attachment_ocr",
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? (supplierHint || null),
        warehouseId: warehouse?.id ?? null,
        warehouseName: warehouse?.name ?? null,
        items: actionRows.map((row) => ({
          productId: row.product!.id,
          productName: row.product!.name,
          sku: row.product!.sku,
          quantity: row.quantity,
          unitCost: row.unitCost,
          discount: row.discount,
          confidence: row.confidence,
        })),
        unresolvedItems: unresolvedRows.map((row) => ({
          sku: row.row.sku ?? null,
          text: row.row.text,
          productName: row.row.text,
          unitName: row.row.unitName ?? null,
          quantity: row.quantity,
          unitCost: row.unitCost,
          discount: row.discount,
          lineTotal: row.row.lineTotal ?? null,
          confidence: row.confidence,
          candidates: row.ambiguous.slice(0, 5).map((product) => ({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
          })),
        })),
        discount: 0,
        vatRate: 0,
        amountPaid: 0,
        invoiceNumber: invoiceNumber || undefined,
        note: `AI inbound OCR${invoiceNumber ? ` ${invoiceNumber}` : ""}${supplierHint ? ` · ${supplierHint}` : ""}`,
      },
    },
  };
}

export async function getPriceContext() {
  const [productRows, bookRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(300),
    db
      .select({ id: priceBooks.id, name: priceBooks.name, isDefault: priceBooks.isDefault })
      .from(priceBooks)
      .orderBy(desc(priceBooks.isDefault), asc(priceBooks.sortOrder), asc(priceBooks.name)),
  ]);
  const productIds = productRows.map((product) => product.id);
  const overrideRows = productIds.length
    ? await db
        .select({
          priceBookId: productPrices.priceBookId,
          productId: productPrices.productId,
          price: productPrices.price,
        })
        .from(productPrices)
        .where(inArray(productPrices.productId, productIds))
    : [];
  const overrides = new Map(
    overrideRows.map((row) => [`${row.priceBookId}:${row.productId}`, Number(row.price)]),
  );
  return {
    products: productRows,
    priceBooks: bookRows,
    overrides,
  };
}

function currentBookPrice(
  product: PriceProductOption,
  book: PriceBookOption,
  overrides: Map<string, number>,
) {
  if (book.isDefault) return Number(product.retailPrice);
  return overrides.get(`${book.id}:${product.id}`) ?? Number(product.retailPrice);
}

function matchPriceBook(prompt: string, books: PriceBookOption[]) {
  const q = normalize(prompt);
  const defaultBook = books.find((book) => book.isDefault) ?? books[0] ?? null;
  const wholesale = books.find((book) => normalize(book.name).includes("si") || normalize(book.name).includes("wholesale"));
  if (q.includes("ban le") || q.includes("gia le") || q.includes("retail")) {
    return defaultBook;
  }
  if (q.includes("ban si") || q.includes("gia si") || q.includes("wholesale")) {
    return wholesale ?? defaultBook;
  }
  return matchNamed(prompt, books).match ?? defaultBook;
}

async function getProductCommandContext() {
  const [productRows, categoryRows, brandRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
        categoryId: products.categoryId,
        brandId: products.brandId,
        minStock: products.minStock,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(300),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.name))
      .limit(200),
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .orderBy(asc(brands.name))
      .limit(200),
  ]);
  return { products: productRows, categories: categoryRows, brands: brandRows };
}

async function getCustomerContext() {
  const rows = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      type: customers.type,
      debtLimit: customers.debtLimit,
      note: customers.note,
    })
    .from(customers)
    .where(eq(customers.isActive, true))
    .orderBy(desc(customers.createdAt))
    .limit(300);
  return rows;
}

async function getSalesContext() {
  const [productRows, customerRows, warehouseRows, orderRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(3000),
    getCustomerContext(),
    db
      .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
      .from(warehouses)
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
      .limit(50),
    db
      .select({
        id: orders.id,
        code: orders.code,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        amountPaid: orders.amountPaid,
        customerName: customers.name,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .orderBy(desc(orders.createdAt))
      .limit(200),
  ]);
  return {
    products: productRows,
    customers: customerRows,
    warehouses: warehouseRows,
    orders: orderRows.map((order) => ({ ...order, name: order.code })),
  };
}

const AI_POS_QUANTITY_STARTERS = new Set([
  "at",
  "bat",
  "bo",
  "bong",
  "cong",
  "day",
  "den",
  "duong",
  "hat",
  "hop",
  "lang",
  "mat",
  "may",
  "o",
  "quat",
  "tam",
  "vit",
]);

const AI_POS_SPEC_NUMBER_FOLLOWERS = new Set([
  "canh",
  "chan",
  "chau",
  "day",
  "lo",
  "mau",
  "pha",
  "thiet",
]);

const AI_POS_QUERY_STOPWORDS = new Set([
  "cai",
  "chiec",
  "co",
  "cho",
  "cua",
  "dung",
  "hop",
  "loai",
  "mau",
  "nang",
  "nha",
  "nho",
  "sinh",
  "ve",
  "va",
]);

const AI_POS_NOISY_PRODUCT_TOKENS = new Set([
  "cai",
  "co",
  "cho",
  "day",
  "dung",
  "full",
  "mau",
  "va",
  "wide",
]);

const AI_POS_CORE_TOKENS = new Set([
  "am",
  "at",
  "bat",
  "cam",
  "chieu",
  "cong",
  "den",
  "doi",
  "don",
  "giat",
  "hat",
  "hut",
  "khoi",
  "mat",
  "o",
  "op",
  "quat",
  "tac",
  "tran",
  "tuong",
  "vit",
]);

type ParsedProductLine = {
  product: PriceProductOption;
  quantity: number;
  confidence: number;
};

type ProductTokenProfile = {
  product: PriceProductOption;
  tokens: Set<string>;
};

function normalizeProductText(value: string) {
  return normalize(value)
    .replace(/\bdao\s+chieu\b/g, "2 chieu")
    .replace(/(\d+)\s*([aw])\b/g, "$1$2")
    .replace(/(\d+)\s*(at|bat|bo|bong|cong|den|duong|hat|hop|lang|mat|may|o|quat|vit)\b/g, "$1 $2")
    .replace(/([a-z])(\d+(?:[aw])?)/g, "$1 $2")
    .replace(/(\d+[aw])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function productTokens(value: string) {
  return normalizeProductText(value).split(/\s+/).filter(Boolean);
}

function expandTokenSet(tokens: string[]) {
  const expanded = new Set(tokens);
  if (expanded.has("pana")) expanded.add("panasonic");
  if (expanded.has("panasonic")) expanded.add("pana");
  if (expanded.has("chan")) expanded.add("chau");
  if (expanded.has("chau")) expanded.add("chan");
  if (expanded.has("at") && expanded.has("den")) expanded.add("khoi");
  if (expanded.has("hat") && expanded.has("chieu")) {
    expanded.add("cong");
    expanded.add("tac");
  }
  return expanded;
}

function normalizeQueryTokens(tokens: string[]) {
  const expanded = expandTokenSet(tokens);
  if (expanded.has("at") && expanded.has("den")) expanded.delete("den");
  return [...expanded].filter((token) => {
    if (!token) return false;
    if (AI_POS_QUERY_STOPWORDS.has(token)) return false;
    return token.length > 1 || token === "o" || /\d/.test(token);
  });
}

function numericQuantity(value: string) {
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
  const quantity = Number(value.replace(",", "."));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function isAiPosQuantityStart(tokens: string[], index: number) {
  const quantity = numericQuantity(tokens[index] ?? "");
  if (quantity == null || index >= tokens.length - 1) return false;
  const next = tokens[index + 1] ?? "";
  if (!AI_POS_QUANTITY_STARTERS.has(next)) return false;
  if (AI_POS_SPEC_NUMBER_FOLLOWERS.has(next)) return false;
  if (numericQuantity(next) != null) return false;
  return true;
}

function tokenWeight(token: string) {
  if (/^\d+[aw]$/.test(token)) return 3.5;
  if (/^\d+$/.test(token)) return 2.5;
  if (AI_POS_CORE_TOKENS.has(token)) return 2.2;
  return 1;
}

function unitSpecs(tokens: Iterable<string>, unit: "a" | "w") {
  return new Set(
    [...tokens]
      .filter((token) => new RegExp(`^\\d+${unit}$`).test(token))
  );
}

function hasConflictingUnitSpec(queryTokens: string[], productTokensSet: Set<string>, unit: "a" | "w") {
  const querySpecs = unitSpecs(queryTokens, unit);
  if (querySpecs.size === 0) return false;
  const productSpecs = unitSpecs(productTokensSet, unit);
  if (productSpecs.size === 0) return false;
  return ![...querySpecs].some((spec) => productSpecs.has(spec));
}

function hasCoreMatch(queryTokens: string[], productTokensSet: Set<string>) {
  return queryTokens.some((token) => AI_POS_CORE_TOKENS.has(token) && productTokensSet.has(token));
}

function scoreProductForQuery(queryTokens: string[], profile: ProductTokenProfile) {
  if (queryTokens.length === 0) return 0;
  if (!hasCoreMatch(queryTokens, profile.tokens)) return 0;
  if (hasConflictingUnitSpec(queryTokens, profile.tokens, "a")) return 0;
  if (hasConflictingUnitSpec(queryTokens, profile.tokens, "w")) return 0;

  let totalWeight = 0;
  let matchedWeight = 0;
  for (const token of queryTokens) {
    const weight = tokenWeight(token);
    totalWeight += weight;
    if (profile.tokens.has(token)) matchedWeight += weight;
  }
  if (totalWeight <= 0) return 0;

  const ratio = matchedWeight / totalWeight;
  if (ratio < 0.52) return 0;

  const specBonus =
    unitSpecs(queryTokens, "a").size || unitSpecs(queryTokens, "w").size ? 0.08 : 0;
  const brandBonus =
    (queryTokens.includes("pana") || queryTokens.includes("panasonic")) &&
    (profile.tokens.has("pana") || profile.tokens.has("panasonic")) ? 0.04 : 0;
  return Math.min(0.95, 0.36 + ratio * 0.5 + specBonus + brandBonus);
}

function buildProductProfiles(productOptions: PriceProductOption[]) {
  return productOptions.map((product) => {
    const rawTokens = productTokens(`${product.sku} ${product.name}`);
    const tokens = expandTokenSet(rawTokens.filter((token) => !AI_POS_NOISY_PRODUCT_TOKENS.has(token)));
    return {
      product,
      tokens,
    };
  });
}

function findBestProductMatch(query: string, profiles: ProductTokenProfile[]) {
  const queryTokens = normalizeQueryTokens(productTokens(query));
  let best: { profile: ProductTokenProfile; confidence: number } | null = null;
  for (const profile of profiles) {
    const confidence = scoreProductForQuery(queryTokens, profile);
    if (!best || confidence > best.confidence) {
      best = { profile, confidence };
    }
  }
  return best && best.confidence >= 0.76 ? best : null;
}

function pushParsedLine(lines: ParsedProductLine[], next: ParsedProductLine) {
  const existing = lines.find((line) => line.product.id === next.product.id);
  if (existing) {
    existing.quantity += next.quantity;
    existing.confidence = Math.max(existing.confidence, next.confidence);
    return;
  }
  lines.push(next);
}

function parseSegmentedProductLines(prompt: string, profiles: ProductTokenProfile[]) {
  const tokens = productTokens(prompt);
  const starts = tokens
    .map((_, index) => index)
    .filter((index) => isAiPosQuantityStart(tokens, index));
  const lines: ParsedProductLine[] = [];
  if (starts.length === 0) return lines;

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? tokens.length;
    const quantity = numericQuantity(tokens[start] ?? "") ?? 1;
    const query = tokens.slice(start + 1, end).join(" ");
    const best = findBestProductMatch(query, profiles);
    if (!best) continue;
    pushParsedLine(lines, {
      product: best.profile.product,
      quantity,
      confidence: best.confidence,
    });
  }
  return lines;
}

function parseExactProductLines(prompt: string, productOptions: PriceProductOption[]) {
  const q = normalizeProductText(prompt);
  const matched: ParsedProductLine[] = [];
  const productsBySpecificName = [...productOptions].sort((a, b) => b.name.length - a.name.length);

  for (const product of productsBySpecificName) {
    const name = normalizeProductText(product.name);
    const sku = normalizeProductText(product.sku);
    const tokens = q.split(/\s+/).filter(Boolean);
    const skuHit = sku ? (sku.length <= 2 ? tokens.includes(sku) : q.includes(sku)) : false;
    const nameHit = name.length > 1 && q.includes(name);
    if (!skuHit && !nameHit) continue;

    const source = nameHit ? name : sku;
    const qtyBefore = q.match(new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*(?:x\\s*)?${escapeRegExp(source)}(?:\\s|$)`));
    const qtyAfter = q.match(new RegExp(`${escapeRegExp(source)}\\s*(?:x\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s|$)`));
    const rawQty = qtyBefore?.[1] ?? qtyAfter?.[1];
    const quantity = rawQty ? Number(rawQty.replace(",", ".")) : 1;
    pushParsedLine(matched, {
      product,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      confidence: skuHit ? 0.94 : 0.82,
    });
  }

  return matched;
}

function parseUnresolvedProductSegments(prompt: string, productOptions: PriceProductOption[]) {
  const profiles = buildProductProfiles(productOptions);
  const tokens = productTokens(prompt);
  const starts = tokens
    .map((_, index) => index)
    .filter((index) => isAiPosQuantityStart(tokens, index));
  if (starts.length === 0) return [];

  return starts.flatMap((start, index) => {
    const end = starts[index + 1] ?? tokens.length;
    const quantity = numericQuantity(tokens[start] ?? "") ?? 1;
    const query = cleanName(tokens.slice(start + 1, end).join(" "));
    if (!query) return [];
    const best = findBestProductMatch(query, profiles);
    if (best) return [];
    const sku = query.match(/\b[A-Z]{1,6}\d[A-Z0-9._-]{2,}\b/i)?.[0]?.toUpperCase();
    return [{
      productName: query,
      text: query,
      sku: sku ?? null,
      quantity,
      reason: "not_found_in_catalog",
    }];
  }).slice(0, 20);
}

export function parseProductLines(prompt: string, productOptions: PriceProductOption[]) {
  const profiles = buildProductProfiles(productOptions);
  const segmented = parseSegmentedProductLines(prompt, profiles);
  const exact = parseExactProductLines(prompt, productOptions);
  const lines: ParsedProductLine[] = [];
  for (const line of [...segmented, ...exact]) pushParsedLine(lines, line);
  return lines.slice(0, 30);
}

function attachmentExtractedText(prompt: string) {
  const marker = "[AI attachment parse]";
  const index = prompt.indexOf(marker);
  if (index < 0) return "";
  return cleanName(prompt.slice(index + marker.length).replace(/\s+/g, " ")).slice(0, 300);
}

export function formulaPreview(prompt: string, books: PriceBookOption[]): AiActionPreview {
  const q = normalize(prompt);
  const book = matchPriceBook(prompt, books);
  const amount = q.includes("%") ? parseQuantity(prompt) : parseMoneyAmount(prompt);
  const unit = q.includes("%") ? "pct" : "vnd";
  const base = q.includes("gia von") ? "cost" : q.includes("gia nhap") ? "lastPurchase" : "current";
  const op = q.includes("giam") || q.includes("tru") || q.includes("-") ? "-" : "+";
  const missingFields = [
    ...(book ? [] : ["price_book"]),
    ...(amount != null ? [] : ["amount"]),
  ];
  const canPreview = missingFields.length === 0;
  return {
    id: randomUUID(),
    intent: "apply_price_formula",
    title: "Xem trước áp công thức giá",
    description: canPreview
      ? "Đây là thao tác cập nhật giá hàng loạt. Hãy kiểm tra kỹ trước khi xác nhận."
      : "Tôi nhận ra yêu cầu áp công thức giá nhưng còn thiếu bảng giá hoặc mức thay đổi.",
    confidence: canPreview ? 0.88 : 0.58,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    strongConfirmation: true,
    entityType: "price_book",
    entityId: book?.id ?? null,
    requiredFields: ["price_book", "base", "op", "amount", "unit"],
    missingFields,
    fields: [
      { label: "Bảng giá", value: book?.name ?? "Cần chọn", tone: book ? "success" : "warning" },
      { label: "Nền giá", value: base === "cost" ? "Giá vốn" : base === "lastPurchase" ? "Giá nhập cuối" : "Giá hiện tại" },
      { label: "Công thức", value: amount == null ? "Chưa rõ" : `${op} ${unit === "pct" ? `${amount}%` : moneyText(amount)}`, tone: amount == null ? "warning" : "success" },
    ],
    lines: [
      {
        label: book?.name ?? "Bảng giá",
        value: "Áp cho toàn bộ sản phẩm",
        meta: "Bulk mutation",
        tone: "danger",
      },
    ],
    warnings: [
      "Thao tác này cập nhật giá hàng loạt và ảnh hưởng POS ngay sau xác nhận.",
      "Nên kiểm tra lại bảng giá trước khi xác nhận.",
    ],
    action: {
      type: "apply_price_formula",
      target: "pricing",
      payload: { prompt, priceBookId: book?.id ?? null, priceBookName: book?.name ?? null, base, op, amount, unit },
    },
  };
}

export function restockPreview(prompt: string, restock: RestockRow[]): AiActionPreview {
  const rows = restock.filter((row) => row.suggestedQty > 0).slice(0, 5);
  return {
    id: randomUUID(),
    intent: "create_draft_purchase_order_from_restocking",
    title: "Tạo PO nháp từ gợi ý nhập hàng",
    description: rows.length
      ? `Tôi tìm thấy ${rows.length} mặt hàng ưu tiên để đưa vào PO nháp.`
      : "Hiện chưa có mặt hàng nào cần đưa vào PO nháp.",
    confidence: 0.91,
    state: "preview",
    confirmationRequired: true,
    entityType: "purchase_order",
    requiredFields: ["warehouse", "supplier_strategy", "items"],
    missingFields: rows.length ? [] : ["items"],
    fields: [
      { label: "Chiến lược NCC", value: "Nhà cung cấp tốt nhất" },
      { label: "Số dòng", value: String(rows.length) },
      { label: "Nguồn", value: "AI Restocking 30 ngày" },
    ],
    lines: rows.map((row) => ({
      label: row.name,
      value: `+${row.suggestedQty} ${row.baseUnit}`,
      meta: `${row.sku} · tồn ${row.stock} · còn ${row.daysOfStock == null ? "—" : row.daysOfStock.toFixed(1)} ngày`,
      tone: row.priority === "high" ? "danger" : row.priority === "medium" ? "warning" : "default",
    })),
    warnings: [
      "Xác nhận sẽ tạo PO nháp; phiếu này chưa tăng tồn kho cho tới khi nhận hàng.",
      "Không tăng tồn kho và không ghi sổ quỹ trước khi user xác nhận tạo chứng từ.",
    ],
    action: {
      type: "create_draft_po",
      target: "aiRestocking",
      payload: {
        prompt,
        source: "ai_restocking",
        itemIds: rows.map((row) => row.id),
        items: rows.map((row) => ({
          productId: row.id,
          quantity: row.suggestedQty,
        })),
      },
    },
  };
}

export async function draftPurchaseOrderPreview(prompt: string): Promise<AiActionPreview> {
  const context = await getInboundContext();
  const lines = parseProductLines(prompt, context.products);
  const supplierMatch = matchNamed(prompt, context.suppliers);
  const warehouseMatch = matchNamed(prompt, context.warehouses);
  const warehouse = warehouseMatch.match ?? context.warehouses.find((item) => item.isDefault) ?? context.warehouses[0] ?? null;
  const missingFields = [
    ...(lines.length ? [] : ["items"]),
    ...(warehouse ? [] : ["warehouse"]),
  ];
  const canPreview = missingFields.length === 0;
  const total = lines.reduce((sum, line) => sum + defaultCost(line.product) * line.quantity, 0);
  return {
    id: randomUUID(),
    intent: "create_draft_purchase_order",
    title: "Đặt hàng nhập: PO nháp",
    description: canPreview
      ? "AI đã đọc được danh sách hàng để tạo PO nháp. Hãy kiểm tra trước khi xác nhận."
      : "Cần xác định ít nhất một sản phẩm và kho trước khi tạo PO nháp.",
    confidence: canPreview ? Math.min(0.9, 0.58 + lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(lines.length, 1) * 0.25) : 0.48,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: "purchase_order",
    requiredFields: ["items", "warehouse"],
    missingFields,
    fields: [
      { label: "Loại", value: "PO nháp", tone: "default" },
      { label: "Nhà cung cấp", value: supplierMatch.match?.name ?? "Tự chọn theo sản phẩm" },
      { label: "Kho", value: warehouse?.name ?? "Cần chọn", tone: warehouse ? (warehouseMatch.match ? "success" : "default") : "warning" },
      { label: "Số dòng", value: String(lines.length), tone: lines.length ? "success" : "warning" },
      { label: "Tạm tính", value: moneyText(total) },
    ],
    lines: lines.map((line) => {
      const unitCost = defaultCost(line.product);
      return {
        label: line.product.name,
        value: `${line.quantity} ${line.product.baseUnit}`,
        meta: `${line.product.sku} · giá nhập dự kiến ${moneyText(unitCost)}`,
        tone: line.confidence >= 0.86 ? "success" : "warning",
      };
    }),
    warnings: [
      "PO nháp chưa tăng tồn kho và chưa ghi thanh toán.",
      supplierMatch.match
        ? "Nhà cung cấp đã được nhận theo nội dung người dùng."
        : "Nếu không nêu NCC, hệ thống sẽ dùng NCC chính của sản phẩm hoặc NCC mặc định khi xác nhận.",
    ],
    action: {
      type: "create_draft_purchase_order",
      target: "purchases",
      payload: {
        prompt,
        supplierId: supplierMatch.match?.id ?? null,
        supplierName: supplierMatch.match?.name ?? null,
        warehouseId: warehouse?.id ?? null,
        warehouseName: warehouse?.name ?? null,
        items: lines.map((line) => ({
          productId: line.product.id,
          productName: line.product.name,
          quantity: line.quantity,
          unitCost: defaultCost(line.product),
          discount: 0,
        })),
        note: `AI draft purchase order: ${prompt}`,
      },
    },
  };
}

export async function inboundPreview(prompt: string, parsedAttachments: ParsedAiAttachment[] = []): Promise<AiActionPreview> {
  const context = await getInboundContext();
  const attachmentPreview = parsedAttachments.length
    ? await inboundPreviewFromAttachments(prompt, context, parsedAttachments)
    : null;
  if (attachmentPreview) return attachmentPreview;

  const quantity = parseQuantity(prompt);
  const productMatch = matchNamed(prompt, context.products);
  const warehouseMatch = matchNamed(prompt, context.warehouses);
  const supplierMatch = matchNamed(prompt, context.suppliers);
  const product = productMatch.match;
  const warehouse = warehouseMatch.match ?? context.warehouses.find((item) => item.isDefault) ?? context.warehouses[0] ?? null;
  const supplier = supplierMatch.match ?? context.suppliers[0] ?? null;
  const unitCost = defaultCost(product);
  const missingFields = [
    ...(product ? [] : ["product"]),
    ...(quantity ? [] : ["quantity"]),
    ...(supplier ? [] : ["supplier"]),
    ...(warehouse ? [] : ["warehouse"]),
  ];
  const hasAmbiguity = productMatch.ambiguous.length > 0 || supplierMatch.ambiguous.length > 0 || warehouseMatch.ambiguous.length > 0;
  const canPreview = missingFields.length === 0 && !hasAmbiguity;
  const subtotal = quantity && unitCost ? quantity * unitCost : 0;
  return {
    id: randomUUID(),
    intent: "create_inventory_inbound",
    title: "Xem trước phiếu nhập",
    description: canPreview
      ? "Tôi đã match được sản phẩm và thông tin nhập kho. Hãy kiểm tra trước khi xác nhận."
      : "Tôi nhận ra đây là yêu cầu nhập hàng nhưng cần bổ sung hoặc chọn lại dữ liệu mơ hồ.",
    confidence: Math.min(0.92, 0.45 + productMatch.confidence * 0.35 + (quantity ? 0.12 : 0) + (warehouse ? 0.05 : 0)),
    state: canPreview ? "preview" : hasAmbiguity ? "needs_selection" : "needs_input",
    confirmationRequired: true,
    strongConfirmation: true,
    entityType: "purchase_order",
    requiredFields: ["product", "quantity", "supplier", "warehouse"],
    missingFields,
    fields: [
      { label: "Sản phẩm", value: product ? `${product.name} (${product.sku})` : "Cần chọn", tone: product ? "success" : "warning" },
      { label: "Số lượng", value: quantity ? `${quantity} ${product?.baseUnit ?? ""}`.trim() : "Chưa rõ", tone: quantity ? "default" : "warning" },
      { label: "Kho", value: warehouse ? warehouse.name : "Cần chọn", tone: warehouse ? (warehouseMatch.match ? "success" : "default") : "warning" },
      { label: "Nhà cung cấp", value: supplier ? supplier.name : "Cần chọn", tone: supplier ? (supplierMatch.match ? "success" : "default") : "warning" },
      { label: "Giá vốn dự kiến", value: moneyText(unitCost), tone: unitCost > 0 ? "default" : "warning" },
    ],
    lines: [
      {
        label: product?.name ?? "Sản phẩm từ câu lệnh",
        value: quantity ? `+${quantity} ${product?.baseUnit ?? ""}`.trim() : "Cần số lượng",
        meta: product ? `${product.sku} · tạm tính ${moneyText(subtotal)}` : prompt,
        tone: canPreview ? "success" : "warning",
      },
    ],
    warnings: [
      "Nhập hàng thật sẽ tăng tồn kho và có thể cập nhật giá vốn.",
      ...(supplierMatch.match ? [] : ["NCC không được nêu rõ; hệ thống sẽ dùng NCC mặc định/đầu danh sách nếu bạn xác nhận."]),
      ...(warehouseMatch.match ? [] : ["Kho không được nêu rõ; hệ thống sẽ dùng kho mặc định nếu bạn xác nhận."]),
      ...productMatch.ambiguous.map((item) => `Sản phẩm có thể là: ${item.name} (${item.sku}). Hãy ghi rõ SKU/tên hơn.`),
    ],
    action: {
      type: "create_inventory_inbound",
      target: "inventoryInbound",
      payload: {
        prompt,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        quantity: quantity ?? null,
        unitCost,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? null,
        warehouseId: warehouse?.id ?? null,
        warehouseName: warehouse?.name ?? null,
        items: product && quantity
          ? [{ productId: product.id, quantity, unitCost, discount: 0 }]
          : [],
        discount: 0,
        vatRate: 0,
        amountPaid: 0,
        note: `AI inbound: ${prompt}`,
      },
    },
  };
}

export async function pricePreview(prompt: string): Promise<AiActionPreview> {
  const context = await getPriceContext();
  const productMatch = matchNamed(prompt, context.products);
  const product = productMatch.match;
  const book = matchPriceBook(prompt, context.priceBooks);
  const price = parseMoneyAmount(prompt);
  const oldPrice = product && book ? currentBookPrice(product, book, context.overrides) : null;
  const missingFields = [
    ...(product ? [] : ["product"]),
    ...(book ? [] : ["price_book"]),
    ...(price != null ? [] : ["price"]),
  ];
  const hasAmbiguity = productMatch.ambiguous.length > 0;
  const canPreview = missingFields.length === 0 && !hasAmbiguity;
  return {
    id: randomUUID(),
    intent: "set_product_price",
    title: "Xem trước cập nhật giá",
    description: canPreview
      ? "Tôi đã match được sản phẩm, bảng giá và giá mới. Hãy kiểm tra trước khi xác nhận."
      : "Tôi nhận ra yêu cầu thiết lập giá. Cần match sản phẩm, bảng giá và giá mới trước khi áp dụng.",
    confidence: Math.min(0.93, 0.45 + productMatch.confidence * 0.35 + (book ? 0.08 : 0) + (price != null ? 0.1 : 0)),
    state: canPreview ? "preview" : hasAmbiguity ? "needs_selection" : "needs_input",
    confirmationRequired: true,
    entityType: "product_price",
    requiredFields: ["product", "price_book", "price"],
    missingFields,
    fields: [
      { label: "Sản phẩm", value: product ? `${product.name} (${product.sku})` : "Cần chọn", tone: product ? "success" : "warning" },
      { label: "Bảng giá", value: book?.name ?? "Cần chọn", tone: book ? "success" : "warning" },
      { label: "Giá hiện tại", value: oldPrice == null ? "Chưa rõ" : moneyText(oldPrice), tone: "default" },
      { label: "Giá mới", value: price == null ? "Chưa rõ" : moneyText(price), tone: price == null ? "warning" : "success" },
    ],
    lines: product && price != null
      ? [
          {
            label: product.name,
            value: `${oldPrice == null ? "—" : moneyText(oldPrice)} → ${moneyText(price)}`,
            meta: `${product.sku} · ${book?.name ?? "Bảng giá"}`,
            tone: oldPrice != null && price < oldPrice ? "warning" : "success",
          },
        ]
      : [],
    warnings: [
      "Giá mới sẽ được dùng tại POS sau khi xác nhận.",
      ...productMatch.ambiguous.map((item) => `Sản phẩm có thể là: ${item.name} (${item.sku}). Hãy ghi rõ SKU/tên hơn.`),
    ],
    action: {
      type: "set_product_price",
      target: "pricing",
      payload: {
        prompt,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        sku: product?.sku ?? null,
        priceBookId: book?.id ?? null,
        priceBookName: book?.name ?? null,
        oldPrice,
        price,
      },
    },
  };
}

export async function productCommandPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const context = await getProductCommandContext();
  const isCategory = q.includes("danh muc") || q.includes("category");
  const isBrand = q.includes("thuong hieu") || q.includes("brand");
  const isMinStock = q.includes("ton toi thieu") || q.includes("min stock");
  const isGenericUpdate = q.includes("sua san pham") || q.includes("sửa sản phẩm") || q.includes("cap nhat san pham") || q.includes("cập nhật sản phẩm") || q.includes("edit product") || q.includes("update product");

  if (isCategory) {
    const name = textAfter(prompt, [/tạo danh mục\s+(.+)$/i, /tao danh muc\s+(.+)$/i, /category\s+(.+)$/i]);
    return simpleCreatePreview({
      prompt,
      intent: "create_product_category",
      title: "Tạo danh mục",
      entityType: "category",
      target: "products",
      name,
      requiredLabel: "category_name",
      warning: "Danh mục mới sẽ xuất hiện trong form sản phẩm sau khi xác nhận.",
    });
  }

  if (isBrand) {
    const name = textAfter(prompt, [/tạo thương hiệu\s+(.+)$/i, /tao thuong hieu\s+(.+)$/i, /brand\s+(.+)$/i]);
    return simpleCreatePreview({
      prompt,
      intent: "create_product_brand",
      title: "Tạo thương hiệu",
      entityType: "brand",
      target: "products",
      name,
      requiredLabel: "brand_name",
      warning: "Thương hiệu mới sẽ xuất hiện trong form sản phẩm sau khi xác nhận.",
    });
  }

  if (isMinStock) {
    const productMatch = matchNamed(prompt, context.products);
    const product = productMatch.match;
    const value = parseQuantity(prompt);
    const missingFields = [
      ...(product ? [] : ["product"]),
      ...(value != null ? [] : ["min_stock"]),
    ];
    const canPreview = missingFields.length === 0 && productMatch.ambiguous.length === 0;
    return {
      id: randomUUID(),
      intent: "update_product_min_stock",
      title: "Xem trước sửa tồn tối thiểu",
      description: canPreview
        ? "Tôi đã match được sản phẩm và tồn tối thiểu mới."
        : "Cần match sản phẩm và tồn tối thiểu mới trước khi lưu.",
      confidence: canPreview ? 0.84 : 0.55,
      state: canPreview ? "preview" : productMatch.ambiguous.length ? "needs_selection" : "needs_input",
      confirmationRequired: true,
      entityType: "product",
      entityId: product?.id ?? null,
      requiredFields: ["product", "min_stock"],
      missingFields,
      fields: [
        { label: "Sản phẩm", value: product ? `${product.name} (${product.sku})` : "Cần chọn", tone: product ? "success" : "warning" },
        { label: "Tồn tối thiểu cũ", value: product ? String(Number(product.minStock)) : "—" },
        { label: "Tồn tối thiểu mới", value: value == null ? "Chưa rõ" : String(value), tone: value == null ? "warning" : "success" },
      ],
      lines: product && value != null ? [{ label: product.name, value: `${Number(product.minStock)} → ${value}`, meta: product.sku, tone: "success" }] : [],
      warnings: productMatch.ambiguous.map((item) => `Sản phẩm có thể là: ${item.name} (${item.sku}). Hãy ghi rõ SKU/tên hơn.`),
      action: {
        type: "update_product_min_stock",
        target: "products",
        payload: { prompt, productId: product?.id ?? null, productName: product?.name ?? null, sku: product?.sku ?? null, oldMinStock: product ? Number(product.minStock) : null, minStock: value },
      },
    };
  }

  if (isGenericUpdate) {
    const productMatch = matchNamed(prompt, context.products);
    const product = productMatch.match;
    const canPreview = Boolean(product) && productMatch.ambiguous.length === 0;
    return {
      id: randomUUID(),
      intent: "update_product",
      title: "Mở form sửa sản phẩm",
      description: canPreview
        ? "Tôi đã match được sản phẩm. Hãy mở form để kiểm tra/chỉnh sửa trước khi lưu."
        : "Cần xác định sản phẩm trước khi mở đúng form sửa.",
      confidence: canPreview ? 0.78 : 0.5,
      state: canPreview ? "preview" : productMatch.ambiguous.length ? "needs_selection" : "needs_input",
      confirmationRequired: false,
      entityType: "product",
      entityId: product?.id ?? null,
      requiredFields: ["product"],
      missingFields: product ? [] : ["product"],
      fields: [{ label: "Sản phẩm", value: product ? `${product.name} (${product.sku})` : "Cần chọn", tone: product ? "success" : "warning" }],
      lines: product ? [{ label: product.name, value: product.sku, tone: "success" }] : [],
      warnings: productMatch.ambiguous.map((item) => `Sản phẩm có thể là: ${item.name} (${item.sku}). Hãy ghi rõ SKU/tên hơn.`),
      action: {
        type: "open_product_edit",
        target: "products",
        payload: { prompt, productId: product?.id ?? null, productName: product?.name ?? null, sku: product?.sku ?? null },
      },
    };
  }

  const name = textAfter(prompt, [/tạo sản phẩm\s+(.+?)(?:,\s*sku|\s+sku|\s+giá|\s+gia|$)/i, /tao san pham\s+(.+?)(?:,\s*sku|\s+sku|\s+gia|$)/i]);
  const sku = prompt.match(/\bsku\s*[:#-]?\s*([a-z0-9._-]+)/i)?.[1]?.toUpperCase() ?? "";
  const price = parseMoneyAmount(prompt) ?? 0;
  const category = matchNamed(prompt, context.categories).match ?? context.categories[0] ?? null;
  const missingFields = [
    ...(name ? [] : ["name"]),
    ...(category ? [] : ["category"]),
  ];
  const canPreview = missingFields.length === 0;
  return {
    id: randomUUID(),
    intent: "create_product",
    title: "Tạo sản phẩm",
    description: canPreview
      ? "Tôi đã đọc được thông tin sản phẩm cơ bản. Hãy kiểm tra trước khi tạo."
      : "Cần tối thiểu tên sản phẩm và danh mục để tạo sản phẩm.",
    confidence: canPreview ? 0.82 : 0.52,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: "product",
    requiredFields: ["name", "category"],
    missingFields,
    fields: [
      { label: "Tên", value: name || "Cần nhập", tone: name ? "success" : "warning" },
      { label: "SKU", value: sku || "Tự sinh" },
      { label: "Danh mục", value: category?.name ?? "Cần chọn", tone: category ? "success" : "warning" },
      { label: "Giá bán lẻ", value: moneyText(price) },
    ],
    lines: name ? [{ label: name, value: sku || "SKU tự sinh", meta: `Giá ${moneyText(price)}`, tone: "success" }] : [],
    warnings: category ? ["Nếu không nêu danh mục, AI dùng danh mục đầu tiên hiện có."] : ["Chưa có danh mục để gán sản phẩm."],
    action: {
      type: "create_product",
      target: "products",
      payload: { prompt, name, sku: sku || undefined, categoryId: category?.id ?? null, categoryName: category?.name ?? null, retailPrice: price, costPrice: 0, baseUnit: "cái" },
    },
  };
}

function simpleCreatePreview(input: {
  prompt: string;
  intent: string;
  title: string;
  entityType: string;
  target: string;
  name: string;
  requiredLabel: string;
  warning: string;
}): AiActionPreview {
  const canPreview = Boolean(input.name);
  return {
    id: randomUUID(),
    intent: input.intent,
    title: input.title,
    description: canPreview ? `Tôi sẽ tạo "${input.name}".` : "Cần tên trước khi tạo.",
    confidence: canPreview ? 0.86 : 0.5,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: input.entityType,
    requiredFields: [input.requiredLabel],
    missingFields: canPreview ? [] : [input.requiredLabel],
    fields: [{ label: "Tên", value: input.name || "Cần nhập", tone: canPreview ? "success" : "warning" }],
    lines: input.name ? [{ label: input.name, value: "Tạo mới", tone: "success" }] : [],
    warnings: [input.warning],
    action: { type: input.intent, target: input.target, payload: { prompt: input.prompt, name: input.name } },
  };
}

export async function customerPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const customers = await getCustomerContext();
  const isUpdate = q.includes("cap nhat") || q.includes("sua ");
  if (isUpdate) {
    const match = matchNamed(prompt, customers);
    const customer = match.match;
    const type: CustomerOption["type"] | null = q.includes("vip") || q.includes("si") ? "wholesale" : null;
    const missingFields = [
      ...(customer ? [] : ["customer"]),
      ...(type ? [] : ["type"]),
    ];
    const canPreview = missingFields.length === 0 && match.ambiguous.length === 0;
    return {
      id: randomUUID(),
      intent: "update_customer",
      title: "Cập nhật khách hàng",
      description: canPreview ? "Tôi đã match được khách hàng và thay đổi cần lưu." : "Cần xác định khách hàng và trường cần cập nhật.",
      confidence: canPreview ? 0.8 : 0.5,
      state: canPreview ? "preview" : match.ambiguous.length ? "needs_selection" : "needs_input",
      confirmationRequired: true,
      entityType: "customer",
      entityId: customer?.id ?? null,
      requiredFields: ["customer", "type"],
      missingFields,
      fields: [
        { label: "Khách hàng", value: customer ? `${customer.name} (${customer.code ?? "KH"})` : "Cần chọn", tone: customer ? "success" : "warning" },
        { label: "Loại mới", value: type ?? "Chưa rõ", tone: type ? "success" : "warning" },
      ],
      lines: customer && type ? [{ label: customer.name, value: `${customer.type} → ${type}`, tone: "success" }] : [],
      warnings: ["VIP hiện được map sang nhóm khách sỉ/wholesale."],
      action: {
        type: "update_customer",
        target: "customers",
        payload: {
          prompt,
          id: customer?.id ?? null,
          name: customer?.name ?? null,
          phone: customer?.phone ?? undefined,
          type,
          debtLimit: Number(customer?.debtLimit ?? 0),
          note: customer?.note ?? undefined,
        },
      },
    };
  }

  const phone = prompt.match(/(?:số điện thoại|sdt|phone)\s*[:#-]?\s*([0-9+\s.-]{8,})/i)?.[1]?.replace(/\s+/g, "") ?? "";
  const name = textAfter(prompt, [/thêm khách\s+(.+?)(?:,\s*số điện thoại|\s+số điện thoại|,\s*sdt|\s+sdt|$)/i, /them khach\s+(.+?)(?:,\s*sdt|\s+sdt|$)/i]);
  const type: CustomerOption["type"] = q.includes("si") || q.includes("vip") ? "wholesale" : "retail";
  const missingFields = name ? [] : ["name"];
  return {
    id: randomUUID(),
    intent: "create_customer",
    title: "Tạo khách hàng",
    description: name ? "Tôi đã đọc được thông tin khách hàng cơ bản." : "Cần tên khách hàng trước khi tạo.",
    confidence: name ? 0.82 : 0.5,
    state: name ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: "customer",
    requiredFields: ["name"],
    missingFields,
    fields: [
      { label: "Tên", value: name || "Cần nhập", tone: name ? "success" : "warning" },
      { label: "Điện thoại", value: phone || "Chưa có" },
      { label: "Loại", value: type },
    ],
    lines: name ? [{ label: name, value: phone || "Không có SĐT", meta: type, tone: "success" }] : [],
    warnings: [],
    action: { type: "create_customer", target: "customers", payload: { prompt, name, phone, type, debtLimit: 0 } },
  };
}

export function cashbookPreview(prompt: string): AiActionPreview {
  const q = normalize(prompt);
  const amount = parseMoneyAmount(prompt);
  const isIncome = q.includes("ghi thu") || q.includes("thu ");
  const category = q.includes("cong no") ? "debt_collect" : isIncome ? "other" : "expense";
  const note = cleanName(prompt.replace(/ghi\s*(thu|chi)/i, "").replace(/\d[\d.,]*(?:\s*(k|nghin|ngàn|ngan|₫|d|đ|vnd))?/gi, ""));
  const missingFields = amount == null ? ["amount"] : [];
  const canPreview = missingFields.length === 0;
  return {
    id: randomUUID(),
    intent: "create_cashbook_entry",
    title: isIncome ? "Ghi thu sổ quỹ" : "Ghi chi sổ quỹ",
    description: canPreview ? "Tôi đã đọc được khoản thu/chi. Hãy kiểm tra trước khi ghi sổ." : "Cần số tiền trước khi ghi sổ.",
    confidence: canPreview ? 0.82 : 0.52,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    strongConfirmation: true,
    entityType: "cash_transaction",
    requiredFields: ["amount"],
    missingFields,
    fields: [
      { label: "Loại", value: isIncome ? "Thu" : "Chi", tone: isIncome ? "success" : "warning" },
      { label: "Quỹ", value: "Tiền mặt" },
      { label: "Số tiền", value: amount == null ? "Chưa rõ" : moneyText(amount), tone: amount == null ? "warning" : "success" },
      { label: "Danh mục", value: category },
    ],
    lines: amount != null ? [{ label: note || prompt, value: moneyText(amount), tone: isIncome ? "success" : "warning" }] : [],
    warnings: ["Ghi sổ quỹ là nghiệp vụ tiền mặt, cần quản lý xác nhận."],
    action: { type: "create_cashbook_entry", target: "cashbook", payload: { prompt, type: isIncome ? "in" : "out", fund: "cash", amount, category, note: note || prompt } },
  };
}

export async function reportSummaryPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const asksCreateStocktake =
    (q.includes("tao") || q.includes("lap") || q.includes("create")) &&
    (q.includes("phieu kiem kho") || q.includes("stocktake"));
  const asksStockView =
    !asksCreateStocktake &&
    (q.includes("ton kho") || q.includes("kiem ton") || q.includes("kiem kho") || q.includes("stock"));
  const asksCustomerReport =
    q.includes("khach") ||
    q.includes("customer") ||
    q.includes("da mua") ||
    q.includes("mua bao nhieu") ||
    q.includes("loi nhuan theo khach");

  if (asksCreateStocktake) {
    return {
      id: randomUUID(),
      intent: "create_stocktake",
      title: "Mở phiếu kiểm kho",
      description: "Tôi sẽ mở màn tạo phiếu kiểm kho để bạn kiểm tra/chỉnh sửa trước khi lưu.",
      confidence: 0.78,
      state: "preview",
      confirmationRequired: false,
      entityType: "stocktake",
      requiredFields: [],
      missingFields: [],
      fields: [{ label: "Màn hình", value: "Tạo phiếu kiểm kho", tone: "success" }],
      lines: [],
      warnings: ["CTA chỉ mở form nghiệp vụ; chưa tạo phiếu kiểm kho."],
      action: { type: "open_stocktake_form", target: "stocktakes", payload: { prompt } },
    };
  }

  if (asksStockView) {
    const context = await getProductCommandContext();
    const product = matchNamed(prompt, context.products).match;
    return {
      id: randomUUID(),
      intent: "inventory_stock_view",
      title: "Mở tồn kho",
      description: product ? "Tôi đã match được sản phẩm để mở tồn kho đã lọc." : "Tôi sẽ mở màn tồn kho để bạn kiểm tra số lượng.",
      confidence: product ? 0.82 : 0.68,
      state: "preview",
      confirmationRequired: false,
      entityType: "inventory_stock",
      entityId: product?.id ?? null,
      requiredFields: [],
      missingFields: [],
      fields: [
        { label: "Màn hình", value: "Tồn kho", tone: "success" },
        { label: "Bộ lọc", value: product ? `${product.name} (${product.sku})` : prompt },
      ],
      lines: product ? [{ label: product.name, value: product.sku, tone: "success" }] : [],
      warnings: ["CTA chỉ mở màn tồn kho; không thay đổi dữ liệu."],
      action: {
        type: "open_inventory_stock_view",
        target: "inventory",
        payload: { prompt, productId: product?.id ?? null, productName: product?.name ?? null, sku: product?.sku ?? null, query: product?.sku ?? prompt },
      },
    };
  }

  const customers = await getCustomerContext();
  const customerMatch = matchNamed(prompt, customers);
  const customer = asksCustomerReport ? customerMatch.match : null;
  return {
    id: randomUUID(),
    intent: asksCustomerReport ? "customer_report" : "report_summary",
    title: asksCustomerReport ? "Mở báo cáo theo khách" : "Mở báo cáo",
    description: customer
      ? "Tôi đã match được khách hàng để mở báo cáo đã lọc."
      : asksCustomerReport
        ? "Tôi sẽ mở báo cáo với bộ lọc từ câu hỏi để bạn kiểm tra."
        : "Tôi sẽ mở màn báo cáo để bạn xem số liệu.",
    confidence: customer ? 0.82 : 0.62,
    state: "preview",
    confirmationRequired: false,
    entityType: asksCustomerReport ? "customer_report" : "report",
    entityId: customer?.id ?? null,
    requiredFields: [],
    missingFields: [],
    fields: [
      { label: "Màn hình", value: "Báo cáo", tone: "success" },
      ...(asksCustomerReport ? [{ label: "Khách hàng", value: customer ? customer.name : prompt, tone: customer ? "success" as const : "warning" as const }] : []),
    ],
    lines: customer ? [{ label: customer.name, value: customer.code ?? "Khách hàng", meta: customer.phone ?? undefined, tone: "success" }] : [],
    warnings: ["CTA chỉ mở báo cáo; không thay đổi dữ liệu."],
    action: {
      type: "open_report",
      target: "reports",
      payload: {
        prompt,
        query: prompt,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerQuery: asksCustomerReport ? prompt : null,
      },
    },
  };
}

export async function orderActionPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const context = await getSalesContext();
  const isPayment = q.includes("thanh toan") || q.includes("da tra") || q.includes("tra tien");
  const isConvert = q.includes("chuyen") && (q.includes("bao gia") || q.includes("quote"));
  const isCancel = q.includes("huy hoa don") || q.includes("huy don") || q.includes("xoa hoa don") || q.includes("xoa don") || q.includes("delete invoice") || q.includes("delete order") || q.includes("cancel invoice") || q.includes("cancel order");
  const isEditInvoice = q.includes("sua hoa don") || q.includes("sua don") || q.includes("edit invoice") || q.includes("edit order");
  const isFindInvoice = q.includes("tim hoa don") || q.includes("tim don") || q.includes("xem hoa don") || q.includes("find invoice") || q.includes("find order");
  const isReturn = q.includes("tra hang") || q.includes("hoan hang") || q.includes("hoan tien") || q.includes("refund") || q.includes("return");
  const isEinvoice = q.includes("hoa don dien tu") || q.includes("e invoice") || q.includes("einvoice") || q.includes("e-invoice");
  const orderCode = prompt.match(/\b(?:HD|DH|BG)[A-Z0-9-]+\b/i)?.[0] ?? "";

  if (isEditInvoice || isFindInvoice) {
    const order = orderCode
      ? context.orders.find((item) => normalize(item.code) === normalize(orderCode)) ?? null
      : matchNamed(prompt, context.orders as OrderOption[]).match;
    const intent = isEditInvoice ? "edit_invoice" : "find_invoice";
    const missingFields = order ? [] : ["order"];
    return {
      id: randomUUID(),
      intent,
      title: isEditInvoice ? "Mở hóa đơn để sửa" : "Tìm hóa đơn",
      description: order
        ? "Tôi đã tìm thấy hóa đơn/đơn hàng liên quan. Hãy mở màn đơn hàng để kiểm tra trước khi thao tác."
        : "Cần chọn đúng hóa đơn/đơn hàng từ danh sách.",
      confidence: order ? 0.78 : 0.5,
      state: order ? "preview" : "needs_input",
      confirmationRequired: false,
      entityType: "order",
      entityId: order?.id ?? null,
      requiredFields: ["order"],
      missingFields,
      fields: [
        { label: "Hóa đơn", value: order?.code ?? (orderCode || "Cần mã hóa đơn/đơn"), tone: order ? "success" : "warning" },
        { label: "Khách", value: order?.customerName ?? "—" },
        { label: "Tổng", value: order ? moneyText(order.total) : "—" },
      ],
      lines: order ? [{ label: order.code, value: moneyText(order.total), meta: order.customerName ?? "Khách lẻ", tone: "success" }] : [],
      warnings: ["CTA chỉ mở màn đơn hàng; chưa thay đổi dữ liệu."],
      action: {
        type: intent,
        target: "orders",
        payload: { prompt, orderId: order?.id ?? null, orderCode: order?.code ?? (orderCode || null), query: orderCode || prompt },
      },
    };
  }

  if (isCancel || isReturn || isEinvoice) {
    const order = orderCode
      ? context.orders.find((item) => normalize(item.code) === normalize(orderCode)) ?? null
      : matchNamed(prompt, context.orders as OrderOption[]).match;
    const missingFields = order ? [] : ["order"];
    const intent = isCancel ? "cancel_invoice" : isReturn ? "create_return_refund" : "send_einvoice";
    const title = isCancel
      ? "Hủy hóa đơn/đơn hàng"
      : isReturn
        ? "Hoàn trả/hoàn tiền"
        : "Phát hành/gửi hóa đơn điện tử";
    return {
      id: randomUUID(),
      intent,
      title,
      description: order
        ? "Tôi đã tìm thấy chứng từ liên quan. Đây là thao tác nhạy cảm, hãy kiểm tra kỹ trước khi tiếp tục."
        : "Cần chọn đúng hóa đơn/đơn hàng trước khi tạo preview thao tác nhạy cảm.",
      confidence: order ? 0.76 : 0.48,
      state: order ? "preview" : "needs_input",
      confirmationRequired: true,
      strongConfirmation: true,
      entityType: isEinvoice ? "einvoice" : isReturn ? "return" : "order",
      entityId: order?.id ?? null,
      requiredFields: ["order"],
      missingFields,
      fields: [
        { label: "Chứng từ", value: order?.code ?? "Cần mã hóa đơn/đơn", tone: order ? "success" : "warning" },
        { label: "Khách", value: order?.customerName ?? "Khách lẻ" },
        { label: "Trạng thái", value: order?.status ?? "—" },
        { label: "Thanh toán", value: order?.paymentStatus ?? "—" },
        { label: "Tổng", value: order ? moneyText(order.total) : "—" },
      ],
      lines: order
        ? [{ label: order.code, value: moneyText(order.total), meta: order.customerName ?? "Khách lẻ", tone: "warning" }]
        : [],
      warnings: [
        isCancel
          ? "Hủy hóa đơn/đơn hàng có thể hoàn tồn kho, đảo công nợ và ảnh hưởng báo cáo."
          : isReturn
            ? "Hoàn trả/hoàn tiền có thể tạo chứng từ trả hàng, ghi sổ quỹ và ảnh hưởng tồn kho."
            : "Hóa đơn điện tử có thể gửi dữ liệu ra nhà cung cấp hóa đơn và phát sinh trạng thái pháp lý.",
        "AI chỉ tạo preview và audit; thao tác thật phải đi qua API nghiệp vụ và quyền hiện có.",
      ],
      action: {
        type: intent,
        target: isEinvoice ? "einvoices" : "orders",
        payload: {
          prompt,
          orderId: order?.id ?? null,
          orderCode: order?.code ?? (orderCode || null),
        },
      },
    };
  }

  if (isPayment) {
    const amount = parseMoneyAmount(prompt);
    const order = orderCode
      ? context.orders.find((item) => normalize(item.code) === normalize(orderCode)) ?? null
      : matchNamed(prompt, context.orders as OrderOption[]).match;
    const method = q.includes("chuyen khoan") || q.includes("bank")
      ? "bank_transfer"
      : q.includes("the") || q.includes("card")
        ? "card"
        : "cash";
    const remaining = order ? Math.max(0, Number(order.total) - Number(order.amountPaid)) : 0;
    const missingFields = [
      ...(order ? [] : ["order"]),
      ...(amount != null ? [] : ["amount"]),
    ];
    const canPreview = missingFields.length === 0;
    return {
      id: randomUUID(),
      intent: "record_invoice_payment",
      title: "Ghi nhận thanh toán hóa đơn",
      description: canPreview
        ? "Tôi đã match được hóa đơn và số tiền thanh toán. Hãy kiểm tra trước khi ghi nhận."
        : "Cần xác định hóa đơn và số tiền trước khi ghi nhận thanh toán.",
      confidence: canPreview ? 0.84 : 0.54,
      state: canPreview ? "preview" : "needs_input",
      confirmationRequired: true,
      strongConfirmation: true,
      entityType: "order_payment",
      entityId: order?.id ?? null,
      requiredFields: ["order", "amount", "method"],
      missingFields,
      fields: [
        { label: "Hóa đơn", value: order ? order.code : "Cần mã hóa đơn", tone: order ? "success" : "warning" },
        { label: "Khách", value: order?.customerName ?? "Khách lẻ" },
        { label: "Còn phải thu", value: order ? moneyText(remaining) : "—" },
        { label: "Số tiền thu", value: amount == null ? "Chưa rõ" : moneyText(amount), tone: amount == null ? "warning" : "success" },
        { label: "Phương thức", value: method === "bank_transfer" ? "Chuyển khoản" : method === "card" ? "Thẻ" : "Tiền mặt" },
      ],
      lines: order && amount != null
        ? [{ label: order.code, value: moneyText(amount), meta: `Còn ${moneyText(remaining)}`, tone: amount > remaining ? "warning" : "success" }]
        : [],
      warnings: [
        "Ghi nhận thanh toán sẽ ghi sổ quỹ và cập nhật trạng thái công nợ.",
        ...(amount != null && order && amount > remaining ? ["Số tiền lớn hơn phần còn phải thu; hệ thống sẽ chỉ ghi tối đa phần còn lại."] : []),
      ],
      action: {
        type: "record_invoice_payment",
        target: "orders",
        payload: {
          prompt,
          orderId: order?.id ?? null,
          orderCode: order?.code ?? (orderCode || null),
          amount,
          method,
          note: `AI payment: ${prompt}`,
        },
      },
    };
  }

  if (isConvert) {
    const order = orderCode
      ? context.orders.find((item) => normalize(item.code) === normalize(orderCode)) ?? null
      : matchNamed(prompt, context.orders as OrderOption[]).match;
    const missingFields = order ? [] : ["quote"];
    const isQuote = order?.status === "quote";
    return {
      id: randomUUID(),
      intent: "convert_quote_to_order",
      title: "Chuyển báo giá thành đơn",
      description: order && isQuote
        ? "Tôi đã tìm thấy báo giá. Xác nhận sẽ chốt thành đơn bán và trừ kho."
        : "Cần chọn đúng báo giá trước khi chuyển thành đơn.",
      confidence: order && isQuote ? 0.82 : 0.5,
      state: order && isQuote ? "preview" : "needs_input",
      confirmationRequired: true,
      strongConfirmation: true,
      entityType: "order",
      entityId: order?.id ?? null,
      requiredFields: ["quote"],
      missingFields: isQuote ? missingFields : ["quote"],
      fields: [
        { label: "Báo giá", value: order?.code ?? "Cần mã báo giá", tone: order && isQuote ? "success" : "warning" },
        { label: "Trạng thái", value: order?.status ?? "—", tone: isQuote ? "success" : "warning" },
        { label: "Tổng", value: order ? moneyText(order.total) : "—" },
      ],
      lines: order ? [{ label: order.code, value: moneyText(order.total), meta: order.customerName ?? "Khách lẻ", tone: isQuote ? "success" : "warning" }] : [],
      warnings: ["Chuyển báo giá thành đơn sẽ trừ kho và ghi công nợ nếu chưa thanh toán."],
      action: {
        type: "convert_quote_to_order",
        target: "orders",
        payload: { prompt, orderId: order?.id ?? null, orderCode: order?.code ?? (orderCode || null) },
      },
    };
  }

  const lines = parseProductLines(prompt, context.products);
  const unresolvedItems = parseUnresolvedProductSegments(prompt, context.products);
  const customer = matchNamed(prompt, context.customers).match;
  const warehouse = matchNamed(prompt, context.warehouses).match ?? context.warehouses.find((item) => item.isDefault) ?? context.warehouses[0] ?? null;
  const isQuote = q.includes("bao gia") || q.includes("quote");
  const missingFields = [
    ...(lines.length ? [] : ["items"]),
    ...(warehouse ? [] : ["warehouse"]),
  ];
  const canPreview = missingFields.length === 0;
  return {
    id: randomUUID(),
    intent: "create_order",
    title: isQuote ? "Tạo báo giá từ câu lệnh" : "Tạo đơn hàng từ câu lệnh",
    description: canPreview
      ? "Tôi đã đọc được các dòng hàng. Hãy kiểm tra trước khi tạo chứng từ."
      : "Cần xác định ít nhất một sản phẩm và kho trước khi tạo chứng từ.",
    confidence: canPreview ? Math.min(0.88, 0.56 + lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(lines.length, 1) * 0.24) : 0.48,
    state: canPreview ? "preview" : "needs_input",
    confirmationRequired: true,
    strongConfirmation: !isQuote,
    entityType: isQuote ? "quote" : "order",
    requiredFields: ["items", "warehouse"],
    missingFields,
    fields: [
      { label: "Loại", value: isQuote ? "Báo giá" : "Đơn bán", tone: isQuote ? "default" : "warning" },
      { label: "Khách", value: customer ? customer.name : "Khách lẻ" },
      { label: "Kho", value: warehouse?.name ?? "Cần chọn", tone: warehouse ? "success" : "warning" },
      { label: "Số dòng", value: unresolvedItems.length ? `${lines.length}/${lines.length + unresolvedItems.length}` : String(lines.length), tone: unresolvedItems.length ? "warning" : lines.length ? "success" : "warning" },
    ],
    lines: lines.map((line) => ({
      label: line.product.name,
      value: `${line.quantity} ${line.product.baseUnit}`,
      meta: `${line.product.sku} · ${moneyText(Number(line.product.retailPrice) * line.quantity)}`,
      tone: "success",
    })),
    warnings: [
      isQuote
        ? "Tạo báo giá không trừ kho; chỉ chuyển thành đơn sau khi xác nhận riêng."
        : "Tạo đơn bán sẽ trừ kho và có thể ghi công nợ nếu chưa thanh toán.",
      "AI không tự thanh toán hóa đơn; nếu cần thu tiền hãy dùng lệnh ghi nhận thanh toán riêng.",
      ...unresolvedItems.map((item) => `Không tìm thấy sản phẩm trong danh mục: ${item.sku ? `${item.sku} · ` : ""}${item.productName}. Dòng này chưa được thêm vào POS.`),
    ],
    action: {
      type: "create_order",
      target: "orders",
      payload: {
        prompt,
        mode: isQuote ? "quote" : "sale",
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        warehouseId: warehouse?.id ?? null,
        warehouseName: warehouse?.name ?? null,
        items: lines.map((line) => ({
          productId: line.product.id,
          productName: line.product.name,
          unitName: line.product.baseUnit,
          unitMultiplier: 1,
          quantity: line.quantity,
        })),
        unresolvedItems,
        payment: { method: "credit", amount: 0 },
        discount: 0,
        taxRate: 0,
        shippingFee: 0,
        note: `AI order: ${prompt}`,
      },
    },
  };
}

function posMatchQualityText(confidence: number) {
  if (confidence >= 0.9) return "Khớp tốt";
  if (confidence >= 0.82) return "Cần kiểm tra";
  return "Khớp tương đối, kiểm tra kỹ";
}

export async function posCartPreview(prompt: string, source: "voice" | "image"): Promise<AiActionPreview> {
  const context = await getSalesContext();
  const lines = parseProductLines(prompt, context.products);
  const unresolvedItems = parseUnresolvedProductSegments(prompt, context.products);
  const unresolvedText = source === "image" ? attachmentExtractedText(prompt) : "";
  const missingFields = lines.length ? [] : ["items"];
  const sourceText = source === "voice" ? "Danh sách nhập tay/giọng nói" : "Ảnh/OCR";
  return {
    id: randomUUID(),
    intent: source === "voice" ? "pos_voice_cart_draft" : "pos_image_cart_draft",
    title: "Nháp giỏ POS từ AI",
    description: lines.length
      ? "AI đã tìm được sản phẩm trong danh sách. Hãy kiểm tra tên hàng và số lượng trước khi đưa vào POS."
      : "Chưa tìm được sản phẩm từ nội dung này. Hãy nhập rõ tên hàng, mã SKU hoặc thông số hơn.",
    confidence: lines.length ? 0.78 : 0.42,
    state: lines.length ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: "pos_cart_draft",
    requiredFields: ["items"],
    missingFields,
    fields: [
      { label: "Nguồn", value: sourceText },
      { label: "Dòng đã nhận", value: unresolvedItems.length ? `${lines.length}/${lines.length + unresolvedItems.length}` : String(lines.length), tone: unresolvedItems.length ? "warning" : lines.length ? "success" : "warning" },
    ],
    lines: lines.map((line) => ({
      label: line.product.name,
      value: `${line.quantity} ${line.product.baseUnit}`,
      meta: `Mã ${line.product.sku} · ${posMatchQualityText(line.confidence)}`,
      tone: line.confidence >= 0.9 ? "success" : "warning",
    })),
    warnings: [
      "AI chỉ chuẩn bị giỏ POS nháp; chưa tạo hóa đơn và chưa thanh toán.",
      "Các dòng cần kiểm tra vẫn phải được rà lại trong POS trước khi bán.",
      ...unresolvedItems.map((item) => `Không tìm thấy sản phẩm trong danh mục: ${item.sku ? `${item.sku} · ` : ""}${item.productName}. Dòng này chưa được thêm vào POS.`),
      ...(unresolvedText && lines.length === 0 ? [`OCR/unresolved: ${unresolvedText}`] : []),
    ],
    action: {
      type: source === "voice" ? "pos_voice_cart_draft" : "pos_image_cart_draft",
      target: "pos",
      payload: {
        prompt,
        source,
        items: lines.map((line) => ({
          productId: line.product.id,
          productName: line.product.name,
          sku: line.product.sku,
          unitName: line.product.baseUnit,
          quantity: line.quantity,
          confidence: line.confidence,
        })),
        unresolvedItems,
      },
    },
  };
}

function forcedIntentFromActionPreset(prompt: string): AiPlannerIntent | null {
  const match = prompt.match(/\[AI_ACTION_PRESET:([a-z_]+)\]/);
  if (!match) return null;
  const intent = match[1];
  if (
    intent === "order_action" ||
    intent === "create_draft_purchase_order" ||
    intent === "create_inventory_inbound"
  ) {
    return intent;
  }
  return null;
}

function stripActionPresetMarker(prompt: string) {
  const withoutMarker = prompt.replace(/\[AI_ACTION_PRESET:[a-z_]+\]\s*/g, "").trim();
  const userInfoMatch = withoutMarker.match(/(?:Thông tin người dùng|User information):\s*([\s\S]*)$/i);
  return (userInfoMatch?.[1] ?? withoutMarker).trim();
}

export async function buildAiAssistantResponse(input: {
  prompt: string;
  revenue: unknown;
  collected: unknown;
  restock: RestockRow[];
  chartRows: unknown[];
  parsedAttachments?: ParsedAiAttachment[];
  surface?: string;
}): Promise<AiAssistantResponse> {
  const rawPrompt = input.prompt.trim();
  const forcedIntent = forcedIntentFromActionPreset(rawPrompt);
  const planner = await planAiAssistantIntent({
    prompt: stripActionPresetMarker(rawPrompt),
    hasAttachments: Boolean(input.parsedAttachments?.length),
  });
  if (planner.ok && planner.tokenUsage) {
    await recordAiTokenUsage(planner.tokenUsage, undefined, {
      surface: input.surface ?? "web",
      actionType: "planner",
      metadata: {
        hasAttachments: Boolean(input.parsedAttachments?.length),
      },
    });
  }
  const plannerPlan: AiPlannerResult | null =
    planner.ok &&
    planner.plan.intent !== "unknown" &&
    planner.plan.confidence >= PLANNER_CONFIDENCE_THRESHOLD
      ? planner.plan
      : null;
  const plannerIntent: AiPlannerIntent | null = forcedIntent ?? plannerPlan?.intent ?? null;
  const prompt = forcedIntent ? stripActionPresetMarker(rawPrompt) : plannerPlan?.canonicalPrompt ?? rawPrompt;
  const asksRestock = plannerIntent === "create_draft_purchase_order_from_restocking";
  const asksDraftPurchase = plannerIntent === "create_draft_purchase_order";
  const asksInbound = plannerIntent === "create_inventory_inbound";
  const asksPrice = plannerIntent === "set_product_price";
  const asksFormula = plannerIntent === "apply_price_formula";
  const asksProductCommand = plannerIntent === "product_command";
  const asksCustomer = plannerIntent === "customer_action";
  const asksCashbook = plannerIntent === "cashbook_action";
  const asksPosVoice = plannerIntent === "pos_voice_cart_draft";
  const asksPosImage = plannerIntent === "pos_image_cart_draft";
  const asksOrderAction = plannerIntent === "order_action";
  const asksReportSummary = plannerIntent === "report_summary";

  const previewTool =
    asksRestock ? "buildRestockPoPreview"
    : asksDraftPurchase ? "buildDraftPurchaseOrderPreview"
    : asksInbound ? "buildInboundPreview"
    : asksFormula ? "buildPriceFormulaPreview"
    : asksProductCommand ? "buildProductPreview"
    : asksCustomer ? "buildCustomerPreview"
    : asksCashbook ? "buildCashbookPreview"
    : asksPosVoice ? "buildPosCartPreview:voice"
    : asksPosImage ? "buildPosCartPreview:image"
    : asksOrderAction ? "buildOrderPreview"
    : asksReportSummary ? "buildReportSummaryPreview"
    : asksPrice ? "buildPriceUpdatePreview"
    : null;
  const toolTrace: AiToolTrace[] = [];
  let actionPreview: AiActionPreview | undefined;
  if (previewTool && toolTrace.length < AI_TOOL_LOOP_MAX_DEPTH) {
    const startedAt = Date.now();
    try {
      actionPreview =
        previewTool === "buildRestockPoPreview"
          ? restockPreview(prompt, input.restock)
        : previewTool === "buildDraftPurchaseOrderPreview"
          ? await draftPurchaseOrderPreview(prompt)
        : previewTool === "buildInboundPreview"
          ? await inboundPreview(prompt, input.parsedAttachments ?? [])
        : previewTool === "buildPriceFormulaPreview"
          ? formulaPreview(prompt, (await getPriceContext()).priceBooks)
        : previewTool === "buildProductPreview"
          ? await productCommandPreview(prompt)
        : previewTool === "buildCustomerPreview"
          ? await customerPreview(prompt)
        : previewTool === "buildCashbookPreview"
          ? cashbookPreview(prompt)
        : previewTool === "buildPosCartPreview:voice"
          ? await posCartPreview(prompt, "voice")
        : previewTool === "buildPosCartPreview:image"
          ? await posCartPreview(prompt, "image")
        : previewTool === "buildOrderPreview"
          ? await orderActionPreview(prompt)
        : previewTool === "buildReportSummaryPreview"
          ? await reportSummaryPreview(prompt)
        : previewTool === "buildPriceUpdatePreview"
          ? await pricePreview(prompt)
          : undefined;
      toolTrace.push({
        depth: 1,
        tool: previewTool,
        mutation: false,
        status: "succeeded",
        durationMs: Date.now() - startedAt,
        result: {
          state: actionPreview?.state,
          intent: actionPreview?.intent,
          entityType: actionPreview?.entityType,
          lineCount: actionPreview?.lines.length,
          warningCount: actionPreview?.warnings.length,
        },
      });
    } catch (error) {
      toolTrace.push({
        depth: 1,
        tool: previewTool,
        mutation: false,
        status: "failed",
        durationMs: Date.now() - startedAt,
        result: { warningCount: 1 },
      });
      throw error;
    }
  }
  if (actionPreview) {
    actionPreview = mergePlannerGuidance(actionPreview, plannerPlan);
    actionPreview = withAiPreviewReviewAction(actionPreview);
  }

  if (actionPreview) {
    const followUpText =
      actionPreview.state === "needs_input" || actionPreview.state === "needs_selection"
        ? plannerPlan?.suggestedNextQuestion || actionPreview.warnings[0] || actionPreview.description
        : actionPreview.description;
    return {
      text: followUpText,
      state: actionPreview.state,
      prompt,
      actionPreview,
      actions: [
        { type: "open", target: actionPreview.action.target, label: "Open related screen" },
      ],
      chart: { type: "revenueByDay", rows: input.chartRows },
      toolTrace,
    };
  }

  const shouldShowReportSummary = asksReportSummary;
  if (!shouldShowReportSummary) {
    return buildGeneralAssistantResponse({
      prompt,
      suggestedNextQuestion: planner.ok ? planner.plan.suggestedNextQuestion : undefined,
      toolTrace,
    });
  }

  return {
    text:
      `Doanh thu 30 ngày: ${moneyText(input.revenue)}. ` +
      `Đã thu: ${moneyText(input.collected)}. ` +
      `Có ${input.restock.length} mặt hàng cần theo dõi nhập lại.`,
    state: "succeeded",
    prompt,
    actions: [
      { type: "open", target: "reports", label: "Open reports" },
      { type: "open", target: "aiRestocking", label: "Review restocking" },
    ],
    chart: {
      type: "revenueByDay",
      rows: input.chartRows,
    },
    toolTrace,
  };
}
