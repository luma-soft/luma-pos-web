import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts, profiles, storeSettings } from "@/db/schema";
import { parseStorePrefs, type StorePrefs } from "@/lib/schemas/settings";

export type StoreSettings = {
  name: string; address: string; phone: string; taxCode: string;
  industry: string; currency: string; locale: string; onboarded: boolean;
  prefs: StorePrefs;
};

export function sanitizeStorePrefsForClient(prefs: StorePrefs): StorePrefs {
  const hasOpenaiApiKey = Boolean(prefs.ai.openaiApiKey);
  const hasZaloAppSecret = Boolean(prefs.zalo.appSecret);
  const hasZaloAccessToken = Boolean(prefs.zalo.accessToken);
  const hasZaloRefreshToken = Boolean(prefs.zalo.refreshToken);
  const hasZaloWebhookSecret = Boolean(prefs.zalo.webhookSecret);
  const hasShopeePartnerKey = Boolean(prefs.shopee.partnerKey);
  return {
    ...prefs,
    ai: {
      ...prefs.ai,
      openaiApiKey: "",
      openaiApiKeySet: hasOpenaiApiKey || prefs.ai.openaiApiKeySet,
    },
    zalo: {
      ...prefs.zalo,
      appSecret: "",
      appSecretSet: hasZaloAppSecret || prefs.zalo.appSecretSet,
      accessToken: "",
      accessTokenSet: hasZaloAccessToken || prefs.zalo.accessTokenSet,
      refreshToken: "",
      refreshTokenSet: hasZaloRefreshToken || prefs.zalo.refreshTokenSet,
      webhookSecret: "",
      webhookSecretSet: hasZaloWebhookSecret || prefs.zalo.webhookSecretSet,
    },
    shopee: {
      ...prefs.shopee,
      partnerKey: "",
      partnerKeySet: hasShopeePartnerKey || prefs.shopee.partnerKeySet,
    },
  };
}

export async function getRawStorePrefs(storeId: string): Promise<StorePrefs> {
  const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.storeId, storeId)).limit(1);
  if (!row) throw new Error("Store settings not found");
  return parseStorePrefs(row.prefs);
}

export async function getAiProviderSettings(storeId: string) {
  const prefs = await getRawStorePrefs(storeId);
  return prefs.ai;
}

export async function getAiAttachmentsBucket(storeId: string) {
  const ai = await getAiProviderSettings(storeId);
  return ai.attachmentsBucket || "ai-attachments";
}

export async function getZaloSettings(storeId: string) {
  const prefs = await getRawStorePrefs(storeId);
  return prefs.zalo;
}

export async function getShopeeSettings(storeId: string) {
  const prefs = await getRawStorePrefs(storeId);
  return prefs.shopee;
}

/** Cấu hình của đúng cửa hàng; không fallback sang tenant khác. */
export async function getStoreSettings(storeId: string): Promise<StoreSettings> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, storeId)).limit(1);
  if (!row) throw new Error("Store settings not found");
  return {
    name: row.name, address: row.address, phone: row.phone, taxCode: row.taxCode,
    industry: row.industry, currency: row.currency, locale: row.locale, onboarded: row.onboarded,
    prefs: sanitizeStorePrefsForClient(parseStorePrefs(row.prefs)),
  };
}

/** Danh sách nhân viên (profiles). */
export async function getStaff(storeId: string) {
  return db
    .select({ id: profiles.id, fullName: profiles.fullName, phone: profiles.phone, role: profiles.role, isActive: profiles.isActive, cashierPinUpdatedAt: profiles.cashierPinUpdatedAt, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.storeId, storeId))
    .orderBy(asc(profiles.fullName));
}
export type StaffRow = Awaited<ReturnType<typeof getStaff>>[number];

export async function getPaymentBankAccounts(storeId: string) {
  const rows = await db
    .select()
    .from(paymentBankAccounts)
    .where(eq(paymentBankAccounts.storeId, storeId))
    .orderBy(asc(paymentBankAccounts.provider), asc(paymentBankAccounts.bankCode), asc(paymentBankAccounts.accountNumber));
  return rows.map(({ webhookSecret, apiKey, ...row }) => ({
    ...row,
    webhookSecretSet: Boolean(webhookSecret),
    apiKeySet: Boolean(apiKey),
  }));
}
export type PaymentBankAccountRow = Awaited<ReturnType<typeof getPaymentBankAccounts>>[number];
