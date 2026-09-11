"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { otherTaxObligations, paymentBankAccounts, products, taxDeclarations } from "@/db/schema";
import { requireManager, type ActionResult } from "@/lib/actions/common";
import { calculateRevenuePercentageTaxes, calculateTaxableIncomeTaxes } from "@/lib/accounting/tax-calculation";
import { getAccountingAuxiliaryBooks, getTaxActivityRevenue } from "@/lib/data/accounting";
import { getRawStorePrefs } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";
import { DIRECT_TAX_REDUCTION_PERCENT } from "@/lib/tax/direct-tax";

const classificationSchema = z.array(z.object({ productId: z.uuid(), activityId: z.string().trim().max(80).nullable() })).max(5000);

export async function updateProductTaxActivities(input: unknown): Promise<ActionResult<void>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = classificationSchema.safeParse(input); if (!parsed.success) return { ok: false, error: "Dữ liệu phân loại không hợp lệ" };
  const prefs = await getRawStorePrefs(gate.storeId);
  const allowed = new Set(prefs.tax.businessActivities.filter((item) => item.enabled).map((item) => item.id));
  if (parsed.data.some((item) => item.activityId && !allowed.has(item.activityId))) return { ok: false, error: "Nhóm ngành thuế không còn hoạt động" };
  await db.transaction(async (tx) => {
    for (const item of parsed.data) {
      await tx.update(products).set({ taxActivityId: item.activityId, updatedAt: sql`now()` }).where(and(eq(products.storeId, gate.storeId), eq(products.id, item.productId)));
    }
  });
  revalidatePath(Routes.Accounting);
  return { ok: true, data: undefined };
}

const declarationSchema = z.object({ periodType: z.enum(["monthly", "quarterly", "annual", "per_occurrence"]), periodKey: z.string().max(20), from: z.iso.datetime(), to: z.iso.datetime() })
  .refine((value) => value.to > value.from, { message: "Khoảng thời gian kê khai không hợp lệ" })
  .refine((value) => ({
    monthly: /^\d{4}-(?:0[1-9]|1[0-2])$/,
    quarterly: /^\d{4}-Q[1-4]$/,
    annual: /^\d{4}$/,
    per_occurrence: /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/,
  })[value.periodType].test(value.periodKey), { message: "Mã kỳ kê khai không hợp lệ" });

export async function prepareTaxDeclaration(input: unknown): Promise<ActionResult<void>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = declarationSchema.safeParse(input); if (!parsed.success) return { ok: false, error: "Kỳ kê khai không hợp lệ" };
  const from = new Date(parsed.data.from); const to = new Date(parsed.data.to);
  const prefs = await getRawStorePrefs(gate.storeId);
  if (prefs.tax.calculationMethod === "unconfigured" || prefs.tax.filingFrequency === "unconfigured") return { ok: false, error: "Cần hoàn tất cài đặt thuế trước khi lập tờ khai" };
  if (parsed.data.periodType !== prefs.tax.filingFrequency) return { ok: false, error: "Kỳ kê khai không khớp với cấu hình thuế hiện tại" };
  const rows = await getTaxActivityRevenue(gate.storeId, from, to);
  const defaultActivity = prefs.tax.businessActivities.find((item) => item.enabled && item.id === prefs.tax.defaultDirectTaxActivityId);
  const normalizedRows = rows.map((row) => row.activityId || !defaultActivity ? row : {
    ...row,
    activityId: defaultActivity.id,
    activityName: defaultActivity.name,
    vatRate: defaultActivity.vatRate,
    pitRate: defaultActivity.pitRate,
  });
  if (normalizedRows.some((row) => !row.activityId)) return { ok: false, error: "Còn doanh thu chưa phân loại nhóm ngành thuế" };
  const books = await getAccountingAuxiliaryBooks(gate.storeId, from, to);
  const expenses = books.purchases.reduce((sum, row) => sum + row.amount, 0) + books.expenses.reduce((sum, row) => sum + row.amount, 0);
  const reductionPercent = prefs.tax.calculationMethod === "revenue_percentage"
    && prefs.tax.defaultTaxReductionOnTransaction
    && prefs.tax.defaultTaxReductionForAllProducts
    ? DIRECT_TAX_REDUCTION_PERCENT
    : 0;
  const reduction = { reduceVatByPercent: reductionPercent };
  const result = prefs.tax.calculationMethod === "taxable_income"
    ? calculateTaxableIncomeTaxes(normalizedRows, expenses, reduction)
    : calculateRevenuePercentageTaxes(normalizedRows, reduction);
  const snapshot = { groups: result.groups, from: parsed.data.from, to: parsed.data.to, calculationMethod: prefs.tax.calculationMethod, expenses, directTaxReductionPercent: reductionPercent };
  await db.insert(taxDeclarations).values({ storeId: gate.storeId, periodType: parsed.data.periodType, periodKey: parsed.data.periodKey, status: "ready", revenue: String(result.revenue), vatAmount: String(result.vatAmount), pitAmount: String(result.pitAmount), snapshot }).onConflictDoUpdate({ target: [taxDeclarations.storeId, taxDeclarations.periodType, taxDeclarations.periodKey], set: { status: "ready", revenue: String(result.revenue), vatAmount: String(result.vatAmount), pitAmount: String(result.pitAmount), snapshot, updatedAt: sql`now()` } });
  revalidatePath(Routes.TaxDeclarations);
  return { ok: true, data: undefined };
}

export async function updateTaxDeclarationStatus(id: string, status: "draft" | "ready" | "submitted" | "accepted" | "rejected", reference?: string): Promise<ActionResult<void>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = z.uuid().safeParse(id); if (!parsed.success) return { ok: false, error: "Tờ khai không hợp lệ" };
  await db.update(taxDeclarations).set({ status, authorityReference: reference?.trim() || null, submittedBy: status === "submitted" ? gate.userId : undefined, submittedAt: status === "submitted" ? new Date() : undefined, updatedAt: sql`now()` }).where(and(eq(taxDeclarations.storeId, gate.storeId), eq(taxDeclarations.id, id)));
  revalidatePath(Routes.TaxDeclarations);
  return { ok: true, data: undefined };
}

export async function updateBankTaxRegistration(id: string, status: "not_declared" | "declared" | "inactive"): Promise<ActionResult<void>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Tài khoản không hợp lệ" };
  await db.update(paymentBankAccounts).set({ taxRegistrationStatus: status, taxRegisteredAt: status === "declared" ? new Date() : null, updatedAt: sql`now()` }).where(and(eq(paymentBankAccounts.storeId, gate.storeId), eq(paymentBankAccounts.id, id)));
  revalidatePath(Routes.TaxDeclarations);
  return { ok: true, data: undefined };
}

const otherTaxSchema = z.object({ occurredOn: z.iso.date(), taxType: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(500), reference: z.string().trim().max(120).optional(), payableAmount: z.number().min(0), paidAmount: z.number().min(0), dueOn: z.union([z.literal(""), z.iso.date()]).optional() }).refine((value) => value.paidAmount <= value.payableAmount, { message: "Số đã nộp không được vượt số phải nộp" });

export async function createOtherTaxObligation(input: unknown): Promise<ActionResult<void>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = otherTaxSchema.safeParse(input); if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const value = parsed.data;
  await db.insert(otherTaxObligations).values({ storeId: gate.storeId, occurredOn: value.occurredOn, taxType: value.taxType, description: value.description, reference: value.reference || null, payableAmount: String(value.payableAmount), paidAmount: String(value.paidAmount), dueOn: value.dueOn || null, paidOn: value.paidAmount === value.payableAmount && value.paidAmount > 0 ? value.occurredOn : null, createdBy: gate.userId });
  revalidatePath(Routes.Accounting);
  return { ok: true, data: undefined };
}
