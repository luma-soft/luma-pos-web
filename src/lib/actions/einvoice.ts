"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices, orders } from "@/db/schema";
import { type ActionResult, requireUser, toMoney } from "./common";
import { Routes } from "@/lib/routes";

const issueSchema = z.object({
  orderId: z.uuid(),
  buyerName: z.string().min(1, { error: "validation.required" }),
  buyerTaxCode: z.string().optional(),
  vatRate: z.number().min(0).max(20).default(10),
});
export type IssueEInvoiceInput = z.input<typeof issueSchema>;

/**
 * Phát hành HĐĐT — STUB PROVIDER.
 * Điểm tích hợp thật (Viettel S-Invoice / VNPT / MISA) thay tại issueWithProvider().
 */
async function issueWithProvider(payload: {
  serial: string; buyerName: string; total: number;
}): Promise<{ number: string }> {
  // TODO(tích hợp thật): gọi API nhà cung cấp HĐĐT, ký số, lấy mã CQT.
  const [{ c }] = await db.select({ c: count() }).from(einvoices);
  void payload;
  return { number: String(c + 1).padStart(8, "0") };
}

export async function issueEInvoice(input: IssueEInvoiceInput): Promise<ActionResult<{ number: string }>> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, v.orderId)).limit(1);
    if (!order) return { ok: false, error: "errors.invalidData" };
    if (order.status !== "completed") return { ok: false, error: "einvoice.errors.onlyCompleted" };

    const [existing] = await db.select({ id: einvoices.id }).from(einvoices).where(eq(einvoices.orderId, v.orderId)).limit(1);
    if (existing) return { ok: false, error: "einvoice.errors.alreadyIssued" };

    const total = Number(order.total);
    const rate = v.vatRate / 100;
    const totalBeforeVat = total / (1 + rate);
    const vatAmount = total - totalBeforeVat;

    const { number } = await issueWithProvider({ serial: "1C26TTP", buyerName: v.buyerName, total });

    await db.insert(einvoices).values({
      orderId: v.orderId,
      status: "issued",
      serial: "1C26TTP",
      number,
      buyerName: v.buyerName,
      buyerTaxCode: v.buyerTaxCode?.trim() || null,
      vatRate: String(v.vatRate),
      totalBeforeVat: toMoney(totalBeforeVat),
      vatAmount: toMoney(vatAmount),
      issuedAt: new Date(),
      note: "Stub provider — chờ tích hợp Viettel/VNPT/MISA",
    });

    revalidatePath(Routes.Sales);
    revalidatePath(Routes.EInvoices);
    revalidatePath(Routes.order(v.orderId));
    return { ok: true, data: { number } };
  } catch (e) {
    console.error("issueEInvoice failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
