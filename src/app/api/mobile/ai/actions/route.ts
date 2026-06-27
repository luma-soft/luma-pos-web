import { createDraftPurchaseForUser } from "@/lib/purchases/draft";
import { createPurchase } from "@/lib/actions/purchases";
import { applyPriceFormulaAll, setProductPrice } from "@/lib/actions/price-books";
import { createBrand, createCategory, createProduct } from "@/lib/actions/products";
import { createCustomer, updateCustomer } from "@/lib/actions/partners";
import { createCashTx } from "@/lib/actions/cashbook";
import { writeAuditLog } from "@/lib/audit";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { db } from "@/db";
import { products } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";
import { eq, sql } from "drizzle-orm";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inboundPayload(preview: Record<string, unknown>) {
  const action = objectValue(preview.action);
  const payload = objectValue(action?.payload);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const firstItem = objectValue(items[0]);
  const productId = typeof firstItem?.productId === "string" ? firstItem.productId : null;
  const quantity = numberValue(firstItem?.quantity);
  const supplierId = typeof payload?.supplierId === "string" ? payload.supplierId : null;
  const warehouseId = typeof payload?.warehouseId === "string" ? payload.warehouseId : null;

  if (!productId || quantity <= 0 || !supplierId || !warehouseId) {
    return null;
  }

  return {
    supplierId,
    warehouseId,
    discount: numberValue(payload?.discount),
    vatRate: numberValue(payload?.vatRate),
    amountPaid: numberValue(payload?.amountPaid),
    invoiceNumber: typeof payload?.invoiceNumber === "string" ? payload.invoiceNumber : undefined,
    note: typeof payload?.note === "string" ? payload.note : "AI inventory inbound",
    items: [
      {
        productId,
        quantity,
        unitCost: numberValue(firstItem?.unitCost),
        discount: numberValue(firstItem?.discount),
      },
    ],
  };
}

function pricePayload(preview: Record<string, unknown>) {
  const action = objectValue(preview.action);
  const payload = objectValue(action?.payload);
  const productId = typeof payload?.productId === "string" ? payload.productId : null;
  const priceBookId = typeof payload?.priceBookId === "string" ? payload.priceBookId : null;
  const price = numberValue(payload?.price, Number.NaN);
  if (!productId || !priceBookId || !Number.isFinite(price) || price < 0) {
    return null;
  }
  return {
    priceBookId,
    productId,
    price,
    oldPrice: numberValue(payload?.oldPrice, Number.NaN),
    productName: typeof payload?.productName === "string" ? payload.productName : null,
    sku: typeof payload?.sku === "string" ? payload.sku : null,
    priceBookName: typeof payload?.priceBookName === "string" ? payload.priceBookName : null,
  };
}

function previewPayload(preview: Record<string, unknown> | null) {
  return objectValue(objectValue(preview?.action)?.payload);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function logAiExecution(input: {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  status: "succeeded" | "failed" | "unauthorized";
  prompt: string | null;
  preview: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  affectedRecords?: Record<string, unknown>[] | null;
  surface: unknown;
  executedTool?: string;
  reason?: string;
}) {
  await writeAuditLog({
    actorUserId: input.userId,
    source: "ai",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    status: input.status,
    prompt: input.prompt,
    parsedIntent: input.preview,
    after: input.after ?? null,
    affectedRecords: input.affectedRecords ?? null,
    metadata: {
      surface: input.surface ?? "assistant",
      ...(input.executedTool ? { executedTool: input.executedTool } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

async function createRestockingDraftPurchase(userId: string, preview: Record<string, unknown>) {
  const action = objectValue(preview.action);
  const payload = objectValue(action?.payload);
  const itemIds = new Set(stringArray(payload?.itemIds));
  const restockRows = await getRestockSuggestions(30);
  const rows = restockRows
    .filter((row) => itemIds.size === 0 || itemIds.has(row.id))
    .slice(0, 25)
    .filter((row) => row.suggestedQty > 0);

  if (rows.length === 0) {
    return { ok: false as const, error: "errors.invalidData" };
  }

  return createDraftPurchaseForUser(userId, {
    note: "Draft from AI Assistant restocking command",
    items: rows.map((row) => ({
      productId: row.id,
      quantity: row.suggestedQty,
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileAction({ ok: false, error: "errors.unauthorized" });

  const body = objectValue(await readJson(request));
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  const event = String(body.event ?? "");
  if (!["confirmed", "cancelled"].includes(event)) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const preview = objectValue(body.actionPreview);
  const intent = String(preview?.intent ?? "ai_action");
  const entityType = String(preview?.entityType ?? "ai_action");
  const entityId = typeof preview?.entityId === "string" ? preview.entityId : null;
  const prompt = typeof body.prompt === "string" ? body.prompt : null;

  if (event === "confirmed" && intent === "create_draft_purchase_order_from_restocking") {
    if (!["owner", "manager", "warehouse"].includes(gate.role)) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "unauthorized",
        prompt,
        parsedIntent: preview,
        metadata: { surface: body.surface ?? "assistant" },
      });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }

    const result = await createRestockingDraftPurchase(gate.userId, preview ?? {});
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: intent,
      entityType: "purchase_order",
      entityId: result.ok ? result.data.id : entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      parsedIntent: preview,
      after: result.ok
        ? {
            id: result.data.id,
            code: result.data.code,
            href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
          }
        : null,
      affectedRecords: result.ok
        ? [
            {
              type: "purchase_order",
              id: result.data.id,
              code: result.data.code,
            },
          ]
        : null,
      metadata: {
        surface: body.surface ?? "assistant",
        event,
        executedTool: "createDraftPurchaseForUser",
      },
    });

    if (!result.ok) {
      return mobileAction(result);
    }

    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã tạo PO nháp ${result.data.code} từ gợi ý nhập hàng AI.`,
        record: {
          type: "purchase_order",
          id: result.data.id,
          code: result.data.code,
          href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
        },
      },
    });
  }

  if (event === "confirmed" && intent === "create_inventory_inbound") {
    if (!["owner", "manager", "warehouse"].includes(gate.role)) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "unauthorized",
        prompt,
        parsedIntent: preview,
        metadata: { surface: body.surface ?? "assistant" },
      });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }

    const payload = preview ? inboundPayload(preview) : null;
    if (!payload) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "failed",
        prompt,
        parsedIntent: preview,
        metadata: {
          surface: body.surface ?? "assistant",
          reason: "missing_required_inbound_fields",
        },
      });
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }

    const result = await createPurchase(payload);
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: intent,
      entityType: "purchase_order",
      entityId: result.ok ? result.data.id : entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      parsedIntent: preview,
      after: result.ok
        ? {
            id: result.data.id,
            code: result.data.code,
            href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
          }
        : null,
      affectedRecords: result.ok
        ? [
            {
              type: "purchase_order",
              id: result.data.id,
              code: result.data.code,
            },
          ]
        : null,
      metadata: {
        surface: body.surface ?? "assistant",
        event,
        executedTool: "createPurchase",
      },
    });

    if (!result.ok) {
      return mobileAction(result);
    }

    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã tạo phiếu nhập ${result.data.code} và cập nhật tồn kho.`,
        record: {
          type: "purchase_order",
          id: result.data.id,
          code: result.data.code,
          href: `/inventory?tab=purchases&q=${encodeURIComponent(result.data.code)}`,
        },
      },
    });
  }

  if (event === "confirmed" && intent === "set_product_price") {
    if (!["owner", "manager"].includes(gate.role)) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "unauthorized",
        prompt,
        parsedIntent: preview,
        metadata: { surface: body.surface ?? "assistant" },
      });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }

    const payload = preview ? pricePayload(preview) : null;
    if (!payload) {
      await writeAuditLog({
        actorUserId: gate.userId,
        source: "ai",
        action: intent,
        entityType,
        entityId,
        status: "failed",
        prompt,
        parsedIntent: preview,
        metadata: {
          surface: body.surface ?? "assistant",
          reason: "missing_required_price_fields",
        },
      });
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }

    const result = await setProductPrice({
      priceBookId: payload.priceBookId,
      productId: payload.productId,
      price: payload.price,
    });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: intent,
      entityType: "product_price",
      entityId: payload.productId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      parsedIntent: preview,
      before: {
        productId: payload.productId,
        priceBookId: payload.priceBookId,
        price: Number.isFinite(payload.oldPrice) ? payload.oldPrice : null,
      },
      after: result.ok
        ? {
            productId: payload.productId,
            priceBookId: payload.priceBookId,
            price: payload.price,
            href: `/inventory?tab=pricing&q=${encodeURIComponent(payload.sku ?? payload.productName ?? "")}`,
          }
        : null,
      affectedRecords: result.ok
        ? [
            {
              type: "product_price",
              productId: payload.productId,
              priceBookId: payload.priceBookId,
              sku: payload.sku,
            },
          ]
        : null,
      metadata: {
        surface: body.surface ?? "assistant",
        event,
        executedTool: "setProductPrice",
      },
    });

    if (!result.ok) {
      return mobileAction(result);
    }

    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã cập nhật ${payload.priceBookName ?? "bảng giá"} của ${payload.productName ?? payload.sku ?? "sản phẩm"} thành ${new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(payload.price)}.`,
        record: {
          type: "product_price",
          id: payload.productId,
          code: payload.sku ?? payload.productName ?? "Sản phẩm",
          href: `/inventory?tab=pricing&q=${encodeURIComponent(payload.sku ?? payload.productName ?? "")}`,
        },
      },
    });
  }

  if (event === "confirmed" && intent === "apply_price_formula") {
    if (!["owner", "manager"].includes(gate.role)) {
      await logAiExecution({ userId: gate.userId, action: intent, entityType, entityId, status: "unauthorized", prompt, preview, surface: body.surface });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }
    const payload = previewPayload(preview);
    const priceBookId = stringValue(payload?.priceBookId);
    const base = stringValue(payload?.base);
    const op = stringValue(payload?.op);
    const unit = stringValue(payload?.unit);
    const amount = numberValue(payload?.amount, Number.NaN);
    if (!priceBookId || !["current", "cost", "lastPurchase"].includes(base ?? "") || !["+", "-"].includes(op ?? "") || !["vnd", "pct"].includes(unit ?? "") || !Number.isFinite(amount)) {
      await logAiExecution({ userId: gate.userId, action: intent, entityType, entityId, status: "failed", prompt, preview, surface: body.surface, reason: "missing_required_formula_fields" });
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }
    const result = await applyPriceFormulaAll({ priceBookId, base: base as "current" | "cost" | "lastPurchase", op: op as "+" | "-", unit: unit as "vnd" | "pct", amount });
    await logAiExecution({
      userId: gate.userId,
      action: intent,
      entityType: "price_book",
      entityId: priceBookId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      preview,
      surface: body.surface,
      executedTool: "applyPriceFormulaAll",
      after: result.ok ? { priceBookId, count: result.data.count, href: "/inventory?tab=pricing" } : null,
      affectedRecords: result.ok ? [{ type: "price_book", id: priceBookId, count: result.data.count }] : null,
    });
    if (!result.ok) return mobileAction(result);
    return mobileAction({
      ok: true,
      data: {
        status: "succeeded",
        executed: true,
        message: `Đã áp công thức cho ${result.data.count} sản phẩm.`,
        record: { type: "price_book", id: priceBookId, code: String(payload?.priceBookName ?? "Bảng giá"), href: "/inventory?tab=pricing" },
      },
    });
  }

  if (event === "confirmed" && ["create_product_category", "create_product_brand", "create_product", "update_product_min_stock"].includes(intent)) {
    if (!["owner", "manager", "warehouse"].includes(gate.role)) {
      await logAiExecution({ userId: gate.userId, action: intent, entityType, entityId, status: "unauthorized", prompt, preview, surface: body.surface });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }
    const payload = previewPayload(preview);
    let result: { ok: true; data: unknown } | { ok: false; error: string };
    let record: { type: string; id: string; code: string; href: string } | null = null;
    if (intent === "create_product_category") {
      const name = stringValue(payload?.name);
      if (!name) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await createCategory(name);
      if (result.ok) record = { type: "category", id: (result.data as { id: string }).id, code: name, href: "/inventory?tab=products" };
    } else if (intent === "create_product_brand") {
      const name = stringValue(payload?.name);
      if (!name) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await createBrand(name);
      if (result.ok) record = { type: "brand", id: (result.data as { id: string }).id, code: name, href: "/inventory?tab=products" };
    } else if (intent === "create_product") {
      const name = stringValue(payload?.name);
      const categoryId = stringValue(payload?.categoryId);
      if (!name || !categoryId) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await createProduct({
        name,
        sku: stringValue(payload?.sku) ?? undefined,
        categoryId,
        retailPrice: numberValue(payload?.retailPrice),
        costPrice: numberValue(payload?.costPrice),
        baseUnit: stringValue(payload?.baseUnit) ?? "cái",
        priceBookPrices: {},
      } as Parameters<typeof createProduct>[0]);
      if (result.ok) record = { type: "product", id: (result.data as { id: string }).id, code: name, href: `/inventory?tab=products&expanded=${(result.data as { id: string }).id}` };
    } else {
      const productId = stringValue(payload?.productId);
      const minStock = numberValue(payload?.minStock, Number.NaN);
      if (!productId || !Number.isFinite(minStock)) return mobileAction({ ok: false, error: "errors.invalidData" });
      await db.update(products).set({ minStock: String(minStock), updatedAt: sql`now()` }).where(eq(products.id, productId));
      result = { ok: true, data: undefined };
      record = { type: "product", id: productId, code: String(payload?.sku ?? payload?.productName ?? "Sản phẩm"), href: `/inventory?tab=products&expanded=${productId}` };
    }
    await logAiExecution({
      userId: gate.userId,
      action: intent,
      entityType: record?.type ?? entityType,
      entityId: record?.id ?? entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      preview,
      surface: body.surface,
      executedTool: intent,
      after: result.ok ? { record } : null,
      affectedRecords: result.ok && record ? [{ type: record.type, id: record.id, code: record.code }] : null,
    });
    if (!result.ok) return mobileAction(result);
    return mobileAction({ ok: true, data: { status: "succeeded", executed: true, message: `Đã thực hiện ${record?.code ?? "thao tác"}.`, record } });
  }

  if (event === "confirmed" && ["create_customer", "update_customer", "create_cashbook_entry"].includes(intent)) {
    const needsManager = intent !== "create_customer";
    const allowed = needsManager ? ["owner", "manager"].includes(gate.role) : ["owner", "manager", "cashier"].includes(gate.role);
    if (!allowed) {
      await logAiExecution({ userId: gate.userId, action: intent, entityType, entityId, status: "unauthorized", prompt, preview, surface: body.surface });
      return mobileAction({ ok: false, error: "errors.forbidden" });
    }
    const payload = previewPayload(preview);
    let result: { ok: true; data: unknown } | { ok: false; error: string };
    let record: { type: string; id: string; code: string; href: string } | null = null;
    if (intent === "create_customer") {
      const name = stringValue(payload?.name);
      if (!name) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await createCustomer({
        name,
        phone: stringValue(payload?.phone) ?? undefined,
        type: (stringValue(payload?.type) ?? "retail") as "retail" | "wholesale" | "contractor" | "agent",
        debtLimit: numberValue(payload?.debtLimit),
      });
      if (result.ok) record = { type: "customer", id: (result.data as { id: string }).id, code: name, href: `/customers/${(result.data as { id: string }).id}` };
    } else if (intent === "update_customer") {
      const id = stringValue(payload?.id);
      const name = stringValue(payload?.name);
      const type = stringValue(payload?.type);
      if (!id || !name || !type) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await updateCustomer({
        id,
        name,
        phone: stringValue(payload?.phone) ?? undefined,
        type: type as "retail" | "wholesale" | "contractor" | "agent",
        debtLimit: numberValue(payload?.debtLimit),
        note: stringValue(payload?.note) ?? undefined,
      });
      record = { type: "customer", id, code: name, href: `/customers/${id}` };
    } else {
      const amount = numberValue(payload?.amount, Number.NaN);
      const type = stringValue(payload?.type);
      const category = stringValue(payload?.category);
      const note = stringValue(payload?.note);
      if (!Number.isFinite(amount) || !type || !category || !note) return mobileAction({ ok: false, error: "errors.invalidData" });
      result = await createCashTx({ type: type as "in" | "out", fund: "cash", amount, category: category as "expense" | "other" | "debt_collect" | "supplier_payment", note });
      record = { type: "cash_transaction", id: "manual", code: note, href: "/finance?tab=cashbook" };
    }
    await logAiExecution({
      userId: gate.userId,
      action: intent,
      entityType: record?.type ?? entityType,
      entityId: record?.id === "manual" ? null : record?.id ?? entityId,
      status: result.ok ? "succeeded" : "failed",
      prompt,
      preview,
      surface: body.surface,
      executedTool: intent,
      after: result.ok ? { record } : null,
      affectedRecords: result.ok && record ? [{ type: record.type, id: record.id, code: record.code }] : null,
    });
    if (!result.ok) return mobileAction(result);
    return mobileAction({ ok: true, data: { status: "succeeded", executed: true, message: `Đã thực hiện ${record?.code ?? "thao tác"}.`, record } });
  }

  await writeAuditLog({
    actorUserId: gate.userId,
    source: "ai",
    action: intent,
    entityType,
    entityId,
    status: event as "confirmed" | "cancelled",
    prompt,
    parsedIntent: preview,
    metadata: {
      surface: body.surface ?? "assistant",
      note:
        event === "confirmed"
          ? "Framework confirmation logged; business mutation is implemented by later task-specific tools."
          : "User cancelled AI preview before execution.",
    },
  });

  return mobileAction({
    ok: true,
    data: {
      status: event,
      message:
        event === "confirmed"
          ? "Đã ghi nhận xác nhận. Action thực thi thật sẽ được nối ở task nghiệp vụ tiếp theo."
          : "Đã hủy preview, không có dữ liệu nào bị thay đổi.",
    },
  });
}
