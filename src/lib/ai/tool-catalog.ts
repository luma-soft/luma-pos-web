import { and, asc, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { customers, products, suppliers, warehouses } from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import type { ParsedAiAttachment } from "@/lib/ai/attachments";
import type { RestockRow } from "@/lib/data/ai-restock";
import {
  cashbookPreview,
  customerPreview,
  draftPurchaseOrderPreview,
  formulaPreview,
  getPriceContext,
  inboundPreview,
  orderActionPreview,
  posCartPreview,
  pricePreview,
  productCommandPreview,
  restockPreview,
  type AiActionPreview,
} from "@/lib/ai/actions";

export type AiToolName =
  | "getReportsSummary"
  | "searchProducts"
  | "searchSuppliers"
  | "searchCustomers"
  | "searchWarehouses"
  | "buildRestockPoPreview"
  | "buildDraftPurchaseOrderPreview"
  | "buildInboundPreview"
  | "buildPriceUpdatePreview"
  | "buildPriceFormulaPreview"
  | "buildProductPreview"
  | "buildCustomerPreview"
  | "buildCashbookPreview"
  | "buildOrderPreview"
  | "buildPosCartPreview";

export type AiToolDescriptor = {
  name: AiToolName;
  description: string;
  category: "read" | "search" | "preview";
  mutation: false;
  requiresConfirmation: boolean;
};

export type AiToolResult =
  | { kind: "records"; records: Record<string, unknown>[] }
  | { kind: "summary"; summary: Record<string, unknown> }
  | { kind: "preview"; preview: AiActionPreview };

export type AiToolRunInput = {
  storeId: string;
  name: AiToolName;
  prompt?: string;
  query?: string;
  limit?: number;
  restock?: RestockRow[];
  parsedAttachments?: ParsedAiAttachment[];
  source?: "voice" | "image";
  reportSummary?: Record<string, unknown>;
};

export const AI_TOOL_CATALOG: AiToolDescriptor[] = [
  { name: "getReportsSummary", description: "Read current sales/report context.", category: "read", mutation: false, requiresConfirmation: false },
  { name: "searchProducts", description: "Search active products by name, SKU, or barcode.", category: "search", mutation: false, requiresConfirmation: false },
  { name: "searchSuppliers", description: "Search suppliers by name, code, or phone.", category: "search", mutation: false, requiresConfirmation: false },
  { name: "searchCustomers", description: "Search active customers by name, code, or phone.", category: "search", mutation: false, requiresConfirmation: false },
  { name: "searchWarehouses", description: "Search warehouses by name.", category: "search", mutation: false, requiresConfirmation: false },
  { name: "buildRestockPoPreview", description: "Build a draft purchase-order preview from restocking rows.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildDraftPurchaseOrderPreview", description: "Build a draft supplier purchase-order preview from a user-provided item list; does not receive stock.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildInboundPreview", description: "Build an inventory inbound preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildPriceUpdatePreview", description: "Build a single product price update preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildPriceFormulaPreview", description: "Build a bulk price formula preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildProductPreview", description: "Build a product/category/brand create or update preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildCustomerPreview", description: "Build a customer create/update preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildCashbookPreview", description: "Build a cashbook income/expense preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildOrderPreview", description: "Build an order/invoice/payment preview.", category: "preview", mutation: false, requiresConfirmation: true },
  { name: "buildPosCartPreview", description: "Build a POS cart draft preview from voice/image text.", category: "preview", mutation: false, requiresConfirmation: true },
];

function clampLimit(value: unknown, fallback = 8) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.trunc(n))) : fallback;
}

async function searchProducts(storeId: string, query: string, limit: number): Promise<AiToolResult> {
  const match = or(
    accentInsensitiveLike(products.name, query),
    accentInsensitiveLike(products.sku, query),
    accentInsensitiveLike(products.barcode, query),
  );
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      baseUnit: products.baseUnit,
      retailPrice: products.retailPrice,
      totalStock: products.totalStock,
    })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.isActive, true), match))
    .orderBy(asc(products.name))
    .limit(limit);
  return { kind: "records", records: rows };
}

async function searchSuppliers(storeId: string, query: string, limit: number): Promise<AiToolResult> {
  const match = or(
    accentInsensitiveLike(suppliers.name, query),
    accentInsensitiveLike(suppliers.code, query),
    accentInsensitiveLike(suppliers.phone, query),
  );
  const rows = await db
    .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name, phone: suppliers.phone, currentDebt: suppliers.currentDebt })
    .from(suppliers)
    .where(and(eq(suppliers.storeId, storeId), match))
    .orderBy(asc(suppliers.name))
    .limit(limit);
  return { kind: "records", records: rows };
}

async function searchCustomers(storeId: string, query: string, limit: number): Promise<AiToolResult> {
  const match = or(
    accentInsensitiveLike(customers.name, query),
    accentInsensitiveLike(customers.code, query),
    accentInsensitiveLike(customers.phone, query),
  );
  const rows = await db
    .select({ id: customers.id, code: customers.code, name: customers.name, phone: customers.phone, type: customers.type, currentDebt: customers.currentDebt })
    .from(customers)
    .where(and(eq(customers.storeId, storeId), eq(customers.isActive, true), match))
    .orderBy(asc(customers.name))
    .limit(limit);
  return { kind: "records", records: rows };
}

async function searchWarehouses(storeId: string, query: string, limit: number): Promise<AiToolResult> {
  const rows = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses)
    .where(and(eq(warehouses.storeId, storeId), accentInsensitiveLike(warehouses.name, query)))
    .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
    .limit(limit);
  return { kind: "records", records: rows };
}

export function getAiToolCatalog() {
  return AI_TOOL_CATALOG;
}

export async function runAiTool(input: AiToolRunInput): Promise<AiToolResult> {
  const prompt = input.prompt?.trim() || "";
  const query = input.query?.trim() || prompt;
  const limit = clampLimit(input.limit);
  switch (input.name) {
    case "getReportsSummary":
      return { kind: "summary", summary: input.reportSummary ?? {} };
    case "searchProducts":
      return searchProducts(input.storeId, query, limit);
    case "searchSuppliers":
      return searchSuppliers(input.storeId, query, limit);
    case "searchCustomers":
      return searchCustomers(input.storeId, query, limit);
    case "searchWarehouses":
      return searchWarehouses(input.storeId, query, limit);
    case "buildRestockPoPreview":
      return { kind: "preview", preview: restockPreview(prompt, input.restock ?? []) };
    case "buildDraftPurchaseOrderPreview":
      return { kind: "preview", preview: await draftPurchaseOrderPreview(input.storeId, prompt) };
    case "buildInboundPreview":
      return { kind: "preview", preview: await inboundPreview(input.storeId, prompt, input.parsedAttachments ?? []) };
    case "buildPriceUpdatePreview":
      return { kind: "preview", preview: await pricePreview(input.storeId, prompt) };
    case "buildPriceFormulaPreview": {
      const priceContext = await getPriceContext(input.storeId, prompt);
      return { kind: "preview", preview: formulaPreview(prompt, priceContext.priceBooks) };
    }
    case "buildProductPreview":
      return { kind: "preview", preview: await productCommandPreview(input.storeId, prompt) };
    case "buildCustomerPreview":
      return { kind: "preview", preview: await customerPreview(input.storeId, prompt) };
    case "buildCashbookPreview":
      return { kind: "preview", preview: cashbookPreview(prompt) };
    case "buildOrderPreview":
      return { kind: "preview", preview: await orderActionPreview(input.storeId, prompt) };
    case "buildPosCartPreview":
      return { kind: "preview", preview: await posCartPreview(input.storeId, prompt, input.source ?? "voice") };
    default: {
      const exhaustive: never = input.name;
      throw new Error(`Unsupported AI tool: ${exhaustive}`);
    }
  }
}
