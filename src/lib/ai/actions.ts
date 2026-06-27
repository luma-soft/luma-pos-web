import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, suppliers, warehouses } from "@/db/schema";
import type { RestockRow } from "@/lib/data/ai-restock";

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
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
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

type InboundProductOption = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  costPrice: unknown;
  lastPurchasePrice: unknown;
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
      const score =
        sku && q.includes(sku) ? 100 :
        code && q.includes(code) ? 95 :
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

function restockPreview(prompt: string, restock: RestockRow[]): AiActionPreview {
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

async function inboundPreview(prompt: string): Promise<AiActionPreview> {
  const context = await getInboundContext();
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

function pricePreview(prompt: string): AiActionPreview {
  const price = prompt.match(/(\d[\d.,]*)\s*(k|nghin|ngàn|₫|d|đ)?/i)?.[1] ?? "";
  return {
    id: randomUUID(),
    intent: "set_product_price",
    title: "Xem trước cập nhật giá",
    description: "Tôi nhận ra yêu cầu thiết lập giá. Cần match sản phẩm và bảng giá trước khi áp dụng.",
    confidence: 0.74,
    state: "needs_selection",
    confirmationRequired: true,
    entityType: "product_price",
    requiredFields: ["product", "price_book", "price"],
    missingFields: ["product", "price_book", ...(price ? [] : ["price"])],
    fields: [
      { label: "Giá đọc được", value: price || "Chưa rõ", tone: price ? "default" : "warning" },
      { label: "Sản phẩm", value: "Cần chọn", tone: "warning" },
      { label: "Bảng giá", value: "Cần chọn", tone: "warning" },
    ],
    lines: [],
    warnings: [
      "Giá mới sẽ được dùng tại POS sau khi xác nhận.",
      "Bulk price formula sẽ cần xác nhận mạnh hơn ở task riêng.",
    ],
    action: {
      type: "set_product_price",
      target: "pricing",
      payload: { prompt, price: price || null },
    },
  };
}

export async function buildAiAssistantResponse(input: {
  prompt: string;
  revenue: unknown;
  collected: unknown;
  restock: RestockRow[];
  chartRows: unknown[];
}): Promise<AiAssistantResponse> {
  const prompt = input.prompt.trim();
  const q = normalize(prompt);
  const asksRestock =
    q.includes("sap het") ||
    q.includes("restock") ||
    q.includes("goi y nhap") ||
    q.includes("khuyen nghi") ||
    q.includes("po nhap") ||
    q.includes("sku can nhap");
  const asksInbound =
    !asksRestock &&
    (q.includes("nhap ") || q.includes("nhap hang") || q.includes("receive"));
  const asksPrice =
    q.includes("gia") ||
    q.includes("price") ||
    q.includes("bang gia");

  const actionPreview = asksRestock
    ? restockPreview(prompt, input.restock)
    : asksInbound
      ? await inboundPreview(prompt)
      : asksPrice
        ? pricePreview(prompt)
        : undefined;

  if (actionPreview) {
    return {
      text: actionPreview.description,
      state: actionPreview.state,
      prompt,
      actionPreview,
      actions: [
        { type: "open", target: actionPreview.action.target, label: "Open related screen" },
      ],
      chart: { type: "revenueByDay", rows: input.chartRows },
    };
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
  };
}
