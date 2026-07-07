"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiListingSuggestions,
  customers,
  marketplaceMessageThreads,
  marketplaceMessages,
  marketplaceOrderMappings,
  marketplaceProductMappings,
  marketplaceShops,
  marketplaceSyncJobs,
  marketplaceTokens,
  orderItems,
  orders,
  products,
  stockLevels,
  stockMovements,
  warehouses,
} from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { completeAiText, loadAiProviderConfig, parseJsonText } from "@/lib/ai/provider-adapter";
import { consumeAiUsage, recordAiTokenUsage } from "@/lib/ai/usage";
import {
  aiListingFillSchema,
  importShopeeOrderSchema,
  sendMarketplaceMessageSchema,
  shopeeListingDraftSchema,
  type AiListingFillInput,
  type ImportShopeeOrderInput,
  type SendMarketplaceMessageInput,
  type ShopeeListingDraftInput,
} from "@/lib/schemas/marketplace";
import { Routes } from "@/lib/routes";
import { generateCode, requireManager, requireOwner, toMoney, toQty, type ActionResult } from "./common";

function numberFrom(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fallbackListingSuggestion(product: {
  name: string;
  sku: string;
  description: string | null;
  categoryName: string | null;
  brandName: string | null;
  retailPrice: string;
  totalStock: string;
  weight: string | null;
  dimensions: string | null;
  imageUrls: string[] | null;
}) {
  const title = product.name.slice(0, 120);
  const baseDescription = product.description?.trim()
    || `${product.name} - SKU ${product.sku}. Phù hợp đăng bán trên Shopee với thông tin sản phẩm được lấy từ LumaPOS.`;
  return {
    title,
    shortDescription: baseDescription.slice(0, 280),
    description: `${baseDescription}\n\nSKU: ${product.sku}\nThương hiệu: ${product.brandName || "No brand"}\nDanh mục gợi ý: ${product.categoryName || "Shopee category cần chọn"}`,
    bulletHighlights: [
      `SKU ${product.sku}`,
      product.brandName ? `Thương hiệu ${product.brandName}` : "Thông tin thương hiệu có thể chỉnh sửa",
      "Tồn kho và giá được đồng bộ từ LumaPOS",
    ],
    category: { id: "", path: product.categoryName || "", confidence: 0.45 },
    attributes: {
      brand: product.brandName || "",
      condition: "NEW",
      dimensions: product.dimensions || "",
    },
    price: numberFrom(product.retailPrice),
    stock: numberFrom(product.totalStock),
    weight: product.weight ? numberFrom(product.weight) : undefined,
    tags: [product.categoryName, product.brandName, product.sku].filter(Boolean),
    shippingNotes: product.weight ? `Weight from LumaPOS: ${product.weight}` : "Check weight before publishing.",
  };
}

async function getProductForListing(productId: string) {
  const [product] = await db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      description: products.description,
      retailPrice: products.retailPrice,
      totalStock: products.totalStock,
      weight: products.weight,
      dimensions: products.dimensions,
      imageUrls: products.imageUrls,
      categoryName: sql<string | null>`(select name from categories where id = ${products.categoryId} limit 1)`,
      brandName: sql<string | null>`(select name from brands where id = ${products.brandId} limit 1)`,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return product ?? null;
}

async function enqueueShopeeJob(input: {
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  userId?: string;
  shopId?: string | null;
}) {
  await db.insert(marketplaceSyncJobs)
    .values({
      provider: "shopee",
      shopId: input.shopId ?? null,
      jobType: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [marketplaceSyncJobs.provider, marketplaceSyncJobs.idempotencyKey],
      set: {
        payload: input.payload,
        status: "pending",
        updatedAt: sql`now()`,
      },
    });
}

export async function connectShopeeDemoShop(): Promise<ActionResult<{ shopId: string }>> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  try {
    const [shop] = await db.insert(marketplaceShops)
      .values({
        provider: "shopee",
        shopId: `demo-${Date.now()}`,
        shopName: "Shopee Demo Shop",
        region: "VN",
        status: "connected",
        connectedAt: new Date(),
        tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        createdBy: gate.userId,
        metadata: { mode: "demo", note: "Replace with Shopee OAuth callback in production." },
      })
      .returning({ id: marketplaceShops.id });
    await db.insert(marketplaceTokens).values({
      shopId: shop.id,
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      scopes: ["product", "order", "chat"],
    });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "connect_shopee_demo_shop",
      entityType: "marketplace_shop",
      entityId: shop.id,
      status: "succeeded",
      metadata: { provider: "shopee" },
    });
    revalidatePath(Routes.Settings);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: { shopId: shop.id } };
  } catch (e) {
    console.error("connectShopeeDemoShop failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function disconnectShopeeShop(shopId: string): Promise<ActionResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  try {
    await db.update(marketplaceShops).set({
      status: "disconnected",
      disconnectedAt: new Date(),
      updatedAt: sql`now()`,
    }).where(and(eq(marketplaceShops.id, shopId), eq(marketplaceShops.provider, "shopee")));
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "disconnect_shopee_shop",
      entityType: "marketplace_shop",
      entityId: shopId,
      status: "succeeded",
    });
    revalidatePath(Routes.Settings);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("disconnectShopeeShop failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function generateShopeeListingAiFill(input: AiListingFillInput): Promise<ActionResult<Record<string, unknown>>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = aiListingFillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const product = await getProductForListing(parsed.data.productId);
  if (!product) return { ok: false, error: "products.errors.notFound" };

  const fallback = fallbackListingSuggestion(product);
  try {
    const charge = await consumeAiUsage(1);
    if (!charge.ok) return { ok: false, error: "ai.errors.usageLimitExceeded" };
    const config = await loadAiProviderConfig();
    const response = await completeAiText({
      config,
      jsonOnly: true,
      messages: [
        {
          role: "system",
          text: "You create Shopee product listing drafts. Return strict JSON only. Never publish. Keep Vietnamese copy concise and sales-ready.",
        },
        {
          role: "user",
          text: JSON.stringify({
            expectedSchema: {
              title: "string <=120",
              shortDescription: "string",
              description: "string",
              bulletHighlights: ["string"],
              category: { id: "string", path: "string", confidence: "number 0..1" },
              attributes: "object",
              price: "number",
              stock: "number",
              weight: "number optional",
              tags: ["string"],
              shippingNotes: "string",
            },
            product,
            preserveUserFields: parsed.data.preserve,
          }),
        },
      ],
    });
    if (response.tokenUsage) {
      await recordAiTokenUsage(response.tokenUsage, undefined, {
        provider: config.provider,
        actionType: "shopee_listing_autofill",
        surface: "web",
        units: 0,
        metadata: { productId: product.id },
      });
    }
    const parsedJson = parseJsonText(response.text);
    const suggestion = parsedJson && typeof parsedJson === "object" ? parsedJson as Record<string, unknown> : fallback;
    const [row] = await db.insert(aiListingSuggestions).values({
      provider: "shopee",
      productId: product.id,
      mappingId: parsed.data.mappingId,
      model: config.textModel,
      rawPayload: { response: response.raw },
      suggestion,
      createdBy: gate.userId,
    }).returning({ id: aiListingSuggestions.id });
    return { ok: true, data: { ...suggestion, aiSuggestionId: row.id, model: config.textModel } };
  } catch (e) {
    console.error("generateShopeeListingAiFill failed:", e);
    const [row] = await db.insert(aiListingSuggestions).values({
      provider: "shopee",
      productId: product.id,
      mappingId: parsed.data.mappingId,
      model: "fallback",
      rawPayload: { error: e instanceof Error ? e.message : "unknown" },
      suggestion: fallback,
      createdBy: gate.userId,
    }).returning({ id: aiListingSuggestions.id });
    return { ok: true, data: { ...fallback, aiSuggestionId: row.id, model: "fallback" } };
  }
}

export async function saveShopeeListingDraft(input: ShopeeListingDraftInput): Promise<ActionResult<{ mappingId: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = shopeeListingDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const payload = { ...v, provider: "shopee", updatedBy: gate.userId };
    const [row] = await db.insert(marketplaceProductMappings)
      .values({
        provider: "shopee",
        shopId: v.shopId ?? null,
        productId: v.productId,
        externalSku: v.sku,
        status: v.action === "draft" ? "draft" : "ready",
        title: v.title,
        categoryId: v.categoryId,
        categoryPath: v.categoryPath,
        price: toMoney(v.price),
        stock: toQty(v.stock),
        syncMode: v.syncMode,
        minStockThreshold: toQty(v.minStockThreshold),
        outOfStockBehavior: v.outOfStockBehavior,
        draftPayload: payload,
        createdBy: gate.userId,
      })
      .onConflictDoUpdate({
        target: [marketplaceProductMappings.provider, marketplaceProductMappings.productId],
        set: {
          shopId: v.shopId ?? null,
          externalSku: v.sku,
          status: v.action === "draft" ? "draft" : "ready",
          title: v.title,
          categoryId: v.categoryId,
          categoryPath: v.categoryPath,
          price: toMoney(v.price),
          stock: toQty(v.stock),
          syncMode: v.syncMode,
          minStockThreshold: toQty(v.minStockThreshold),
          outOfStockBehavior: v.outOfStockBehavior,
          draftPayload: payload,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: marketplaceProductMappings.id });
    if (v.aiSuggestionId) {
      await db.update(aiListingSuggestions).set({ mappingId: row.id, editedFields: v.editedFields }).where(eq(aiListingSuggestions.id, v.aiSuggestionId));
    }
    await enqueueShopeeJob({
      type: v.action === "draft" ? "listing_draft_saved" : "listing_validate",
      idempotencyKey: `shopee:listing:${v.productId}:${v.action}`,
      payload,
      userId: gate.userId,
      shopId: v.shopId ?? null,
    });
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: { mappingId: row.id } };
  } catch (e) {
    console.error("saveShopeeListingDraft failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function publishShopeeListing(input: ShopeeListingDraftInput): Promise<ActionResult<{ mappingId: string; externalItemId: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const saved = await saveShopeeListingDraft({ ...input, action: "publish" });
  if (!saved.ok) return saved;
  const parsed = shopeeListingDraftSchema.safeParse({ ...input, action: "publish" });
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const externalItemId = `pending-${v.productId.slice(0, 8)}-${Date.now()}`;
    await db.update(marketplaceProductMappings).set({
      status: "published",
      externalItemId,
      lastPayload: { ...v, provider: "shopee" },
      lastResponse: { status: "queued", externalItemId, message: "Queued for Shopee API adapter" },
      lastSyncAt: new Date(),
      lastError: null,
      updatedAt: sql`now()`,
    }).where(eq(marketplaceProductMappings.id, saved.data.mappingId));
    await enqueueShopeeJob({
      type: "listing_publish",
      idempotencyKey: `shopee:publish:${saved.data.mappingId}`,
      payload: { ...v, mappingId: saved.data.mappingId, externalItemId },
      userId: gate.userId,
      shopId: v.shopId ?? null,
    });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "publish_shopee_listing",
      entityType: "marketplace_product_mapping",
      entityId: saved.data.mappingId,
      status: "succeeded",
      metadata: { productId: v.productId, externalItemId },
    });
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: { mappingId: saved.data.mappingId, externalItemId } };
  } catch (e) {
    console.error("publishShopeeListing failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function unpublishShopeeListing(mappingId: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await db.update(marketplaceProductMappings).set({ status: "unlisted", updatedAt: sql`now()` }).where(eq(marketplaceProductMappings.id, mappingId));
    await enqueueShopeeJob({
      type: "listing_unpublish",
      idempotencyKey: `shopee:unpublish:${mappingId}`,
      payload: { mappingId },
      userId: gate.userId,
    });
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("unpublishShopeeListing failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function importShopeeOrder(input: ImportShopeeOrderInput): Promise<ActionResult<{ orderId: string; code: string; duplicate: boolean }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = importShopeeOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [existing] = await db
      .select({ orderId: marketplaceOrderMappings.orderId, code: orders.code })
      .from(marketplaceOrderMappings)
      .leftJoin(orders, eq(orders.id, marketplaceOrderMappings.orderId))
      .where(and(eq(marketplaceOrderMappings.provider, "shopee"), eq(marketplaceOrderMappings.externalOrderSn, v.orderSn)))
      .limit(1);
    if (existing?.orderId && existing.code) return { ok: true, data: { orderId: existing.orderId, code: existing.code, duplicate: true } };

    const [warehouse] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(sql`${warehouses.isDefault} desc`, warehouses.createdAt).limit(1);
    if (!warehouse) return { ok: false, error: "warehouse.errors.notFound" };

    const subtotal = v.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const total = v.total || subtotal + v.shippingFee;
    const result = await db.transaction(async (tx) => {
      let customerId: string | null = null;
      if (v.buyerPhone) {
        const [existingCustomer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.phone, v.buyerPhone)).limit(1);
        if (existingCustomer) customerId = existingCustomer.id;
      }
      if (!customerId) {
        const [customer] = await tx.insert(customers).values({
          code: generateCode("KH"),
          name: v.buyerName || "Shopee customer",
          phone: v.buyerPhone || null,
          address: v.deliveryAddress || null,
          type: "retail",
          note: `Imported from Shopee order ${v.orderSn}`,
        }).returning({ id: customers.id });
        customerId = customer.id;
      }
      const [order] = await tx.insert(orders).values({
        code: generateCode("SHP"),
        status: v.status.toLowerCase().includes("cancel") ? "cancelled" : "completed",
        paymentStatus: "paid",
        customerId,
        warehouseId: warehouse.id,
        deliveryAddress: v.deliveryAddress || null,
        subtotal: toMoney(subtotal),
        shippingFee: toMoney(v.shippingFee),
        total: toMoney(total),
        amountPaid: toMoney(total),
        sourceMode: "shopee",
        note: `Shopee order ${v.orderSn}`,
        createdBy: gate.userId,
      }).returning({ id: orders.id, code: orders.code });
      await tx.insert(orderItems).values(v.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        productName: item.name,
        unitName: "cái",
        unitMultiplier: "1.0000",
        quantity: toQty(item.quantity),
        unitPrice: toMoney(item.unitPrice),
        total: toMoney(item.quantity * item.unitPrice),
      })));
      for (const item of v.items) {
        await tx.insert(stockLevels).values({
          productId: item.productId,
          warehouseId: warehouse.id,
          quantity: toQty(-item.quantity),
        }).onConflictDoUpdate({
          target: [stockLevels.productId, stockLevels.warehouseId],
          set: { quantity: sql`${stockLevels.quantity} - ${toQty(item.quantity)}`, updatedAt: sql`now()` },
        });
        await tx.insert(stockMovements).values({
          productId: item.productId,
          warehouseId: warehouse.id,
          type: "sale",
          quantity: toQty(-item.quantity),
          refType: "order",
          refId: order.id,
          note: `Shopee ${v.orderSn}`,
          createdBy: gate.userId,
        });
      }
      await tx.insert(marketplaceOrderMappings).values({
        provider: "shopee",
        shopId: v.shopId ?? null,
        orderId: order.id,
        externalOrderSn: v.orderSn,
        externalStatus: v.status,
        rawPayload: v.rawPayload,
      });
      return order;
    });
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: { orderId: result.id, code: result.code, duplicate: false } };
  } catch (e) {
    console.error("importShopeeOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function sendMarketplaceMessage(input: SendMarketplaceMessageInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = sendMarketplaceMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.insert(marketplaceMessages).values({
      threadId: v.threadId,
      direction: "out",
      body: v.body,
      sentBy: gate.userId,
      rawPayload: { status: "queued" },
    });
    await db.update(marketplaceMessageThreads).set({ lastMessageAt: new Date(), updatedAt: sql`now()` }).where(eq(marketplaceMessageThreads.id, v.threadId));
    await enqueueShopeeJob({
      type: "message_send",
      idempotencyKey: `shopee:message:${v.threadId}:${Date.now()}`,
      payload: { threadId: v.threadId, body: v.body },
      userId: gate.userId,
    });
    revalidatePath(Routes.OnlineSales);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("sendMarketplaceMessage failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
