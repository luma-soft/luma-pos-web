import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, customers, orders, priceBooks, productPrices, products, suppliers, warehouses } from "@/db/schema";
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

type PriceProductOption = InboundProductOption & {
  retailPrice: unknown;
};

type PriceBookOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

type ProductCommandOption = PriceProductOption & {
  categoryId: string | null;
  brandId: string | null;
  minStock: unknown;
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

async function getPriceContext() {
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
      .limit(400),
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

function parseProductLines(prompt: string, productOptions: PriceProductOption[]) {
  const q = normalize(prompt);
  const matched: Array<{
    product: PriceProductOption;
    quantity: number;
    confidence: number;
  }> = [];
  const seen = new Set<string>();
  const productsBySpecificName = [...productOptions].sort((a, b) => b.name.length - a.name.length);

  for (const product of productsBySpecificName) {
    const name = normalize(product.name);
    const sku = normalize(product.sku);
    const tokens = q.split(/[^a-z0-9]+/).filter(Boolean);
    const skuHit = sku ? (sku.length <= 2 ? tokens.includes(sku) : q.includes(sku)) : false;
    const nameHit = name.length > 1 && q.includes(name);
    if (!skuHit && !nameHit) continue;
    if (seen.has(product.id)) continue;

    const source = nameHit ? name : sku;
    const qtyBefore = q.match(new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*(?:x\\s*)?${escapeRegExp(source)}(?:\\s|$)`));
    const qtyAfter = q.match(new RegExp(`${escapeRegExp(source)}\\s*(?:x\\s*)?(\\d+(?:[.,]\\d+)?)(?:\\s|$)`));
    const rawQty = qtyBefore?.[1] ?? qtyAfter?.[1];
    const quantity = rawQty ? Number(rawQty.replace(",", ".")) : 1;
    matched.push({
      product,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      confidence: skuHit ? 0.94 : 0.82,
    });
    seen.add(product.id);
  }

  return matched.slice(0, 20);
}

function attachmentExtractedText(prompt: string) {
  const marker = "[AI attachment parse]";
  const index = prompt.indexOf(marker);
  if (index < 0) return "";
  return cleanName(prompt.slice(index + marker.length).replace(/\s+/g, " ")).slice(0, 300);
}

function formulaPreview(prompt: string, books: PriceBookOption[]): AiActionPreview {
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

async function pricePreview(prompt: string): Promise<AiActionPreview> {
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

async function productCommandPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const context = await getProductCommandContext();
  const isCategory = q.includes("danh muc") || q.includes("category");
  const isBrand = q.includes("thuong hieu") || q.includes("brand");
  const isMinStock = q.includes("ton toi thieu") || q.includes("min stock");

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

async function customerPreview(prompt: string): Promise<AiActionPreview> {
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

function cashbookPreview(prompt: string): AiActionPreview {
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

async function orderActionPreview(prompt: string): Promise<AiActionPreview> {
  const q = normalize(prompt);
  const context = await getSalesContext();
  const isPayment = q.includes("thanh toan") || q.includes("da tra") || q.includes("tra tien");
  const isConvert = q.includes("chuyen") && (q.includes("bao gia") || q.includes("quote"));
  const orderCode = prompt.match(/\b(?:HD|DH|BG)[A-Z0-9-]+\b/i)?.[0] ?? "";

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
      { label: "Số dòng", value: String(lines.length), tone: lines.length ? "success" : "warning" },
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
        payment: { method: "credit", amount: 0 },
        discount: 0,
        taxRate: 0,
        shippingFee: 0,
        note: `AI order: ${prompt}`,
      },
    },
  };
}

async function posCartPreview(prompt: string, source: "voice" | "image"): Promise<AiActionPreview> {
  const context = await getSalesContext();
  const lines = parseProductLines(prompt, context.products);
  const unresolvedText = source === "image" ? attachmentExtractedText(prompt) : "";
  const missingFields = lines.length ? [] : ["items"];
  return {
    id: randomUUID(),
    intent: source === "voice" ? "pos_voice_cart_draft" : "pos_image_cart_draft",
    title: source === "voice" ? "POS giọng nói: nháp giỏ hàng" : "POS hình ảnh: nháp giỏ hàng",
    description: lines.length
      ? "Tôi đã match được sản phẩm để đưa vào giỏ POS nháp. POS vẫn cần user xác nhận trước khi tạo hóa đơn."
      : "Chưa match được sản phẩm từ nội dung này. Hãy đọc/nhập rõ tên hoặc SKU hơn.",
    confidence: lines.length ? 0.78 : 0.42,
    state: lines.length ? "preview" : "needs_input",
    confirmationRequired: true,
    entityType: "pos_cart_draft",
    requiredFields: ["items"],
    missingFields,
    fields: [
      { label: "Nguồn", value: source === "voice" ? "Giọng nói/transcript" : "Ảnh/OCR text" },
      { label: "Số dòng match", value: String(lines.length), tone: lines.length ? "success" : "warning" },
    ],
    lines: lines.map((line) => ({
      label: line.product.name,
      value: `${line.quantity} ${line.product.baseUnit}`,
      meta: `${line.product.sku} · confidence ${Math.round(line.confidence * 100)}%`,
      tone: line.confidence >= 0.9 ? "success" : "warning",
    })),
    warnings: [
      "AI chỉ tạo giỏ POS nháp, không tự tạo hóa đơn hoặc thanh toán.",
      "Nếu sản phẩm mơ hồ, user cần chọn lại trong POS.",
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
      },
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
  const asksFormula =
    asksPrice &&
    (q.includes("tang") ||
      q.includes("giam") ||
      q.includes("cong thuc") ||
      q.includes("%") ||
      q.includes("gia von"));
  const asksProductCommand =
    q.includes("tao san pham") ||
    q.includes("tạo sản phẩm") ||
    q.includes("tao danh muc") ||
    q.includes("tạo danh mục") ||
    q.includes("tao thuong hieu") ||
    q.includes("tạo thương hiệu") ||
    q.includes("ton toi thieu") ||
    q.includes("min stock");
  const asksCustomer =
    q.includes("them khach") ||
    q.includes("thêm khách") ||
    q.includes("cap nhat khach") ||
    q.includes("cập nhật khách");
  const asksCashbook =
    q.includes("ghi thu") ||
    q.includes("ghi chi");
  const asksPosVoice =
    q.includes("pos voice") ||
    q.includes("gio hang bang giong noi") ||
    q.includes("doc mon") ||
    q.includes("doc san pham");
  const asksPosImage =
    q.includes("pos image") ||
    q.includes("tao gio pos") ||
    q.includes("tạo giỏ pos") ||
    q.includes("gio pos") ||
    q.includes("anh don") ||
    q.includes("ảnh đơn") ||
    q.includes("tu anh") ||
    q.includes("từ ảnh") ||
    q.includes("chup anh") ||
    q.includes("ocr");
  const asksOrderAction =
    !asksPosVoice &&
    !asksPosImage &&
    (q.includes("tao don") ||
      q.includes("tạo đơn") ||
      q.includes("tao hoa don") ||
      q.includes("tạo hóa đơn") ||
      q.includes("bao gia") ||
      q.includes("báo giá") ||
      q.includes("thanh toan") ||
      q.includes("thanh toán"));

  const actionPreview = asksRestock
    ? restockPreview(prompt, input.restock)
    : asksInbound
      ? await inboundPreview(prompt)
    : asksFormula
        ? formulaPreview(prompt, (await getPriceContext()).priceBooks)
    : asksProductCommand
        ? await productCommandPreview(prompt)
    : asksCustomer
        ? await customerPreview(prompt)
    : asksCashbook
        ? cashbookPreview(prompt)
    : asksPosVoice
        ? await posCartPreview(prompt, "voice")
    : asksPosImage
        ? await posCartPreview(prompt, "image")
    : asksOrderAction
        ? await orderActionPreview(prompt)
    : asksPrice
        ? await pricePreview(prompt)
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
