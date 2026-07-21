import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts } from "@/db/schema";
import { getProfileId } from "@/lib/actions/common";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";
import { cancelDraftOrder, createPendingSepayPayment } from "@/lib/payments/service";
import { SEPAY_PAYMENT_TIMEOUT_MS } from "@/lib/payments/service-core";
import { buildSepayVietQrImageUrl } from "@/lib/payments/sepay";

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const input = body as Record<string, unknown>;
  const orderId = typeof input.orderId === "string" ? input.orderId : "";
  const amount = Number(input.amount);
  const requestedBankAccountId = typeof input.bankAccountId === "string" ? input.bankAccountId : "";
  if (!orderId || !Number.isFinite(amount) || amount <= 0) return mobileError("errors.invalidData");

  const [account] = requestedBankAccountId
    ? await db
      .select()
      .from(paymentBankAccounts)
      .where(and(
        eq(paymentBankAccounts.id, requestedBankAccountId),
        eq(paymentBankAccounts.provider, "sepay"),
        eq(paymentBankAccounts.enabled, true),
      ))
      .limit(1)
    : await db
      .select()
      .from(paymentBankAccounts)
      .where(and(eq(paymentBankAccounts.provider, "sepay"), eq(paymentBankAccounts.enabled, true)))
      .orderBy(sql`${paymentBankAccounts.isDefault} desc`, paymentBankAccounts.createdAt)
      .limit(1);

  if (!account) {
    await cancelDraftOrder(orderId);
    return mobileError("payments.errors.bankAccountNotFound");
  }

  const profileId = await getProfileId(gate.userId);
  const result = await createPendingSepayPayment({
    orderId,
    bankAccountId: account.id,
    amount,
    reference: typeof input.reference === "string" ? input.reference : undefined,
    note: typeof input.note === "string" ? input.note : undefined,
    createdBy: profileId ?? gate.userId,
  });
  if (!result.ok) return mobileAction(result);

  return mobileAction({
    ok: true,
    data: {
      paymentId: result.data.id,
      reference: result.data.reference,
      amount: Math.round(amount),
      qrImageUrl: buildSepayVietQrImageUrl({
        bankCode: account.bankCode,
        accountNumber: account.accountNumber,
        amount,
        reference: result.data.reference,
      }),
      bankAccount: {
        id: account.id,
        bankCode: account.bankCode,
        gateway: account.gateway,
        accountNumber: account.accountNumber,
        subAccount: account.subAccount,
        accountName: account.accountName,
      },
      status: "pending",
      expiresAt: new Date(Date.now() + SEPAY_PAYMENT_TIMEOUT_MS).toISOString(),
    },
  });
}
