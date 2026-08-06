"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, orderItems, warehouses } from "@/db/schema";
import { desc } from "drizzle-orm";
import { type ActionResult, generateCode, toMoney, toQty } from "./common";

/**
 * Đặt hàng qua portal (xác thực bằng portalToken, KHÔNG cần đăng nhập).
 * Tạo đơn dạng BÁO GIÁ chờ cửa hàng xác nhận — không đụng kho/nợ.
 * Giá lấy từ DB theo nhóm khách — không tin giá client gửi lên.
 */
const portalOrderSchema = z.object({
  token: z.string().min(20),
  note: z.string().max(500).optional(),
  projectName: z.string().max(200).optional(),
  items: z.array(z.object({
    productId: z.uuid(),
    quantity: z.number().positive().max(1_000_000),
  })).min(1).max(100),
});
export type PortalOrderInput = z.input<typeof portalOrderSchema>;

export async function createPortalOrder(input: PortalOrderInput): Promise<ActionResult<{ code: string }>> {
  const parsed = portalOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const [customer] = await db.select().from(customers).where(eq(customers.portalToken, v.token)).limit(1);
    if (!customer || !customer.isActive) return { ok: false, error: "portal.errors.invalidToken" };

    const { products } = await import("@/db/schema");
    const { inArray } = await import("drizzle-orm");
    const ids = v.items.map((i) => i.productId);
    const productRows = await db.select().from(products).where(inArray(products.id, ids));
    const byId = new Map(productRows.map((p) => [p.id, p]));

    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(desc(warehouses.isDefault)).limit(1);

    const priceFor = (p: typeof productRows[number]) => {
      const pick =
        customer.type === "wholesale" ? p.wholesalePrice :
        customer.type === "contractor" ? p.contractorPrice :
        customer.type === "agent" ? p.agentPrice : null;
      return Number(pick ?? p.retailPrice);
    };

    const lines = v.items.map((i) => {
      const p = byId.get(i.productId);
      if (!p || !p.isActive) throw new Error("PRODUCT_NOT_FOUND");
      const unitPrice = priceFor(p);
      return { p, quantity: i.quantity, unitPrice, total: i.quantity * unitPrice };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values({
        code: generateCode("DO"), // đơn online chờ xác nhận
        documentType: "quote",
        status: "quote",
        paymentStatus: "unpaid",
        customerId: customer.id,
        warehouseId: wh?.id ?? null,
        projectName: v.projectName || null,
        subtotal: toMoney(subtotal),
        total: toMoney(subtotal),
        note: `Đặt qua portal${v.note ? ` · ${v.note}` : ""}`,
      }).returning({ code: orders.code, id: orders.id });

      await tx.insert(orderItems).values(lines.map((l) => ({
        orderId: order.id,
        productId: l.p.id,
        productName: l.p.name,
        unitName: l.p.baseUnit,
        unitMultiplier: toQty(1),
        quantity: toQty(l.quantity),
        unitPrice: toMoney(l.unitPrice),
        total: toMoney(l.total),
      })));

      return order;
    });

    return { ok: true, data: { code: result.code } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "PRODUCT_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("createPortalOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
