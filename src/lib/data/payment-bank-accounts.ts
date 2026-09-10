import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts } from "@/db/schema";

export async function getDefaultSepayBankAccount(storeId: string) {
  const [account] = await db
    .select({
      id: paymentBankAccounts.id,
      bankCode: paymentBankAccounts.bankCode,
      gateway: paymentBankAccounts.gateway,
      accountNumber: paymentBankAccounts.accountNumber,
      accountName: paymentBankAccounts.accountName,
    })
    .from(paymentBankAccounts)
    .where(and(
      eq(paymentBankAccounts.storeId, storeId),
      eq(paymentBankAccounts.provider, "sepay"),
      eq(paymentBankAccounts.enabled, true),
    ))
    .orderBy(sql`${paymentBankAccounts.isDefault} desc`, asc(paymentBankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}
