"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  products, productSuppliers, purchaseOrders, purchaseOrderItems, stockLevels, stockMovements, suppliers,
} from "@/db/schema";
import { createPurchaseSchema, type CreatePurchaseOutput, updatePurchaseSchema, type UpdatePurchaseOutput } from "@/lib/schemas/order";
import { type ActionResult, requireStockAccess, requireManager, getProfileId, generateCode, toMoney, toQty } from "./common";
import { recordCashTx } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { getCurrentShift } from "@/lib/data/shifts";

type PurchaseCalcInput = Pick<CreatePurchaseOutput, "items" | "discount" | "vatRate" | "amountPaid">;

function purchaseLineTotal(i: { quantity: number; unitCost: number; discount: number }) {
  return Math.max(0, i.quantity * i.unitCost - i.discount);
}

function calcPurchaseTotals(v: PurchaseCalcInput) {
  const subtotal = v.items.reduce((s, i) => s + purchaseLineTotal(i), 0);
  const afterDiscount = Math.max(0, subtotal - v.discount);
  const tax = Math.round((afterDiscount * v.vatRate) / 100);
  const total = afterDiscount + tax;
  const paid = Math.min(v.amountPaid, total);
  return { subtotal, tax, total, paid, owed: Math.max(0, total - paid) };
}

function revalidatePurchasePaths(id?: string) {
  revalidatePath(Routes.Purchases);
  revalidatePath(Routes.Inventory);
  revalidatePath(Routes.Products);
  revalidatePath(Routes.Suppliers);
  if (id) revalidatePath(`${Routes.Purchases}/${id}`);
}

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
  const totals = calcPurchaseTotals(v);

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

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
        subtotal: toMoney(totals.subtotal),
        discount: toMoney(v.discount),
        vatRate: String(v.vatRate),
        tax: toMoney(totals.tax),
        total: toMoney(totals.total),
        amountPaid: toMoney(totals.paid),
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
          total: toMoney(purchaseLineTotal(i)),
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
        const netUnit = i.quantity > 0 ? purchaseLineTotal(i) / i.quantity : i.unitCost;
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

      if (totals.owed > 0) {
        await tx.update(suppliers).set({
          currentDebt: sql`${suppliers.currentDebt} + ${toMoney(totals.owed)}`,
        }).where(eq(suppliers.id, v.supplierId));
      }

      if (totals.paid > 0) {
        await recordCashTx(tx, {
          type: "out", fund: "cash", amount: totals.paid,
          category: "supplier_payment", refType: "purchase", refId: po.id,
          note: `Trả NCC ${po.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
        });
      }

      return po;
    });

    revalidatePurchasePaths(result.id);
    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("createPurchase failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Sửa phiếu nhập đã nhận: hoàn tác dòng cũ, áp dòng mới, cập nhật chênh lệch nợ/tiền. */
export async function updatePurchase(input: UpdatePurchaseOutput): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  const parsed = updatePurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const totals = calcPurchaseTotals(v);

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, v.id)).limit(1);
      if (!po) throw new Error("PURCHASE_NOT_FOUND");
      if (po.status !== "received" && po.status !== "draft") throw new Error("NOT_EDITABLE");

      const ids = v.items.map((i) => i.productId);
      const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, ids));
      if (found.length !== new Set(ids).size) throw new Error("PRODUCT_NOT_FOUND");

      const oldItems = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
      const oldPaid = po.status === "received" ? Number(po.amountPaid) : 0;
      const oldOwed = po.status === "received" ? Math.max(0, Number(po.total) - oldPaid) : 0;

      if (po.status === "received") {
        for (const i of oldItems) {
          const qty = Number(i.quantity);
          await tx.update(stockLevels).set({
            quantity: sql`${stockLevels.quantity} - ${toQty(qty)}`,
            updatedAt: sql`now()`,
          }).where(and(eq(stockLevels.productId, i.productId), eq(stockLevels.warehouseId, po.warehouseId)));

          await tx.insert(stockMovements).values({
            productId: i.productId,
            warehouseId: po.warehouseId,
            type: "return_out",
            quantity: toQty(-qty),
            unitCost: i.unitCost,
            refType: "purchase_edit",
            refId: po.id,
            note: `Sửa phiếu nhập ${po.code}: hoàn dòng cũ`,
            createdBy: profileId,
          });
        }
      }

      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
      await tx.insert(purchaseOrderItems).values(
        v.items.map((i) => ({
          purchaseOrderId: po.id,
          productId: i.productId,
          quantity: toQty(i.quantity),
          unitCost: toMoney(i.unitCost),
          discount: toMoney(i.discount),
          total: toMoney(purchaseLineTotal(i)),
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
          refType: "purchase_edit",
          refId: po.id,
          note: `Sửa phiếu nhập ${po.code}`,
          createdBy: profileId,
        });

        const netUnit = i.quantity > 0 ? purchaseLineTotal(i) / i.quantity : i.unitCost;
        await tx.update(products).set({
          costPrice: toMoney(netUnit),
          lastPurchasePrice: toMoney(i.unitCost),
          updatedAt: sql`now()`,
        }).where(eq(products.id, i.productId));

        await tx.insert(productSuppliers)
          .values({ productId: i.productId, supplierId: v.supplierId, costPrice: toMoney(i.unitCost) })
          .onConflictDoNothing();
      }

      await tx.update(products)
        .set({ supplierId: v.supplierId })
        .where(and(inArray(products.id, v.items.map((i) => i.productId)), isNull(products.supplierId)));

      if (po.supplierId === v.supplierId) {
        const debtDiff = totals.owed - oldOwed;
        if (Math.abs(debtDiff) > 1e-9) {
          await tx.update(suppliers).set({
            currentDebt: sql`greatest(${suppliers.currentDebt} + ${toMoney(debtDiff)}, 0)`,
          }).where(eq(suppliers.id, v.supplierId));
        }
      } else {
        if (oldOwed > 0) {
          await tx.update(suppliers).set({
            currentDebt: sql`greatest(${suppliers.currentDebt} - ${toMoney(oldOwed)}, 0)`,
          }).where(eq(suppliers.id, po.supplierId));
        }
        if (totals.owed > 0) {
          await tx.update(suppliers).set({
            currentDebt: sql`${suppliers.currentDebt} + ${toMoney(totals.owed)}`,
          }).where(eq(suppliers.id, v.supplierId));
        }
      }

      const paidDiff = totals.paid - oldPaid;
      if (paidDiff > 1e-9) {
        await recordCashTx(tx, {
          type: "out", fund: "cash", amount: paidDiff,
          category: "supplier_payment", refType: "purchase_edit", refId: po.id,
          note: `Trả thêm NCC ${po.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
        });
      } else if (paidDiff < -1e-9) {
        await recordCashTx(tx, {
          type: "in", fund: "cash", amount: Math.abs(paidDiff),
          category: "supplier_payment", refType: "purchase_edit", refId: po.id,
          note: `Giảm tiền đã trả NCC ${po.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
        });
      }

      await tx.update(purchaseOrders).set({
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        status: "received",
        subtotal: toMoney(totals.subtotal),
        discount: toMoney(v.discount),
        vatRate: String(v.vatRate),
        tax: toMoney(totals.tax),
        total: toMoney(totals.total),
        amountPaid: toMoney(totals.paid),
        invoiceNumber: v.invoiceNumber?.trim()?.slice(0, 50) || null,
        note: v.note || null,
      }).where(eq(purchaseOrders.id, po.id));
    });

    revalidatePurchasePaths(v.id);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      PURCHASE_NOT_FOUND: "purchases.errors.notFound",
      NOT_EDITABLE: "purchases.errors.notEditable",
      PRODUCT_NOT_FOUND: "errors.invalidData",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("updatePurchase failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Hủy phiếu nhập: trừ lại kho đã nhập, xóa nợ NCC còn lại và đảo tiền đã trả. */
export async function cancelPurchase(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
      if (!po) throw new Error("PURCHASE_NOT_FOUND");
      if (po.status === "cancelled") throw new Error("ALREADY_CANCELLED");
      if (po.status === "returned") throw new Error("NOT_EDITABLE");

      if (po.status === "received") {
        const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, po.id));
        for (const i of items) {
          const qty = Number(i.quantity);
          await tx.update(stockLevels).set({
            quantity: sql`${stockLevels.quantity} - ${toQty(qty)}`,
            updatedAt: sql`now()`,
          }).where(and(eq(stockLevels.productId, i.productId), eq(stockLevels.warehouseId, po.warehouseId)));

          await tx.insert(stockMovements).values({
            productId: i.productId,
            warehouseId: po.warehouseId,
            type: "return_out",
            quantity: toQty(-qty),
            unitCost: i.unitCost,
            refType: "purchase_cancel",
            refId: po.id,
            note: `Hủy phiếu nhập ${po.code}`,
            createdBy: profileId,
          });
        }

        const paid = Number(po.amountPaid);
        const owed = Math.max(0, Number(po.total) - paid);
        if (owed > 0) {
          await tx.update(suppliers).set({
            currentDebt: sql`greatest(${suppliers.currentDebt} - ${toMoney(owed)}, 0)`,
          }).where(eq(suppliers.id, po.supplierId));
        }
        if (paid > 0) {
          await recordCashTx(tx, {
            type: "in", fund: "cash", amount: paid,
            category: "supplier_payment", refType: "purchase_cancel", refId: po.id,
            note: `Hoàn tiền đã trả do hủy ${po.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
          });
        }
      }

      await tx.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, po.id));
    });

    revalidatePurchasePaths(id);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      PURCHASE_NOT_FOUND: "purchases.errors.notFound",
      ALREADY_CANCELLED: "purchases.errors.alreadyCancelled",
      NOT_EDITABLE: "purchases.errors.notEditable",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("cancelPurchase failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
