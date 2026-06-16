"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  products, productSuppliers, purchaseOrders, purchaseOrderItems, stockLevels, stockMovements, suppliers,
} from "@/db/schema";
import { createPurchaseSchema, type CreatePurchaseOutput } from "@/lib/schemas/order";
import { type ActionResult, requireStockAccess, getProfileId, generateCode, toMoney, toQty } from "./common";
import { recordCashTx } from "@/lib/cash";
import { Routes } from "@/lib/routes";

/** Tạo phiếu nhập + nhận hàng ngay: cộng kho, cập nhật giá vốn, ghi nợ NCC. */
export async function createPurchase(
  input: CreatePurchaseOutput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  const parsed = createPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  // tiền từng dòng = SL×giá − giảm giá dòng
  const lineTotal = (i: { quantity: number; unitCost: number; discount: number }) =>
    Math.max(0, i.quantity * i.unitCost - i.discount);
  const subtotal = v.items.reduce((s, i) => s + lineTotal(i), 0);
  const afterDiscount = Math.max(0, subtotal - v.discount);
  const tax = Math.round((afterDiscount * v.vatRate) / 100);
  const total = afterDiscount + tax;
  const paid = Math.min(v.amountPaid, total);
  const owed = total - paid;

  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      // validate product ids tồn tại
      const ids = v.items.map((i) => i.productId);
      const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, ids));
      if (found.length !== new Set(ids).size) throw new Error("PRODUCT_NOT_FOUND");

      const [po] = await tx.insert(purchaseOrders).values({
        code: generateCode("PN"),
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        status: "received",
        subtotal: toMoney(subtotal),
        discount: toMoney(v.discount),
        vatRate: String(v.vatRate),
        tax: toMoney(tax),
        total: toMoney(total),
        amountPaid: toMoney(paid),
        invoiceNumber: v.invoiceNumber?.trim()?.slice(0, 50) || null,
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: purchaseOrders.id, code: purchaseOrders.code });

      await tx.insert(purchaseOrderItems).values(
        v.items.map((i) => ({
          purchaseOrderId: po.id,
          productId: i.productId,
          quantity: toQty(i.quantity),
          unitCost: toMoney(i.unitCost),
          discount: toMoney(i.discount),
          total: toMoney(lineTotal(i)),
        }))
      );

      for (const i of v.items) {
        await tx
          .insert(stockLevels)
          .values({
            productId: i.productId,
            warehouseId: v.warehouseId,
            quantity: toQty(i.quantity),
          })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} + ${toQty(i.quantity)}`,
              updatedAt: sql`now()`,
            },
          });

        await tx.insert(stockMovements).values({
          productId: i.productId,
          warehouseId: v.warehouseId,
          type: "purchase",
          quantity: toQty(i.quantity),
          unitCost: toMoney(i.unitCost),
          refType: "purchase",
          refId: po.id,
          note: po.code,
          createdBy: profileId,
        });

        // giá vốn = giá nhập sau chiết khấu dòng; giá nhập cuối = giá trên phiếu (chưa chiết khấu)
        const netUnit = i.quantity > 0 ? lineTotal(i) / i.quantity : i.unitCost;
        await tx.update(products).set({
          costPrice: toMoney(netUnit),
          lastPurchasePrice: toMoney(i.unitCost),
          updatedAt: sql`now()`,
        }).where(eq(products.id, i.productId));

        // tự gắn NCC vào SP (import từ nhập hàng) — không trùng
        await tx.insert(productSuppliers)
          .values({ productId: i.productId, supplierId: v.supplierId, costPrice: toMoney(i.unitCost) })
          .onConflictDoNothing();
      }

      // đặt NCC chính cho SP chưa có NCC chính
      await tx.update(products)
        .set({ supplierId: v.supplierId })
        .where(and(inArray(products.id, v.items.map((i) => i.productId)), isNull(products.supplierId)));

      if (owed > 0) {
        await tx.update(suppliers).set({
          currentDebt: sql`${suppliers.currentDebt} + ${toMoney(owed)}`,
        }).where(eq(suppliers.id, v.supplierId));
      }

      if (paid > 0) {
        await recordCashTx(tx, {
          type: "out", fund: "cash", amount: paid,
          category: "supplier_payment", refType: "purchase", refId: po.id,
          note: `Trả NCC ${po.code}`, createdBy: profileId,
        });
      }

      return po;
    });

    revalidatePath(Routes.Purchases);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.Products);
    revalidatePath(Routes.Suppliers);
    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("createPurchase failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
