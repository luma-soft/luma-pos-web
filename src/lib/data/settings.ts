import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentBankAccounts, profiles, storeSettings } from "@/db/schema";
import { parseStorePrefs, type StorePrefs } from "@/lib/schemas/settings";

export type StoreSettings = {
  name: string; address: string; phone: string; taxCode: string;
  industry: string; currency: string; locale: string; onboarded: boolean;
  prefs: StorePrefs;
};

const DEFAULTS: StoreSettings = {
  name: "", address: "", phone: "", taxCode: "", industry: "grocery", currency: "VND", locale: "vi-VN", onboarded: false,
  prefs: parseStorePrefs({}),
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

export async function getRawStorePrefs(): Promise<StorePrefs> {
  const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
  return parseStorePrefs(row?.prefs);
}

export async function getAiProviderSettings() {
  const prefs = await getRawStorePrefs();
  return prefs.ai;
}

export async function getAiAttachmentsBucket() {
  const ai = await getAiProviderSettings();
  return ai.attachmentsBucket || "ai-attachments";
}

export async function getZaloSettings() {
  const prefs = await getRawStorePrefs();
  return prefs.zalo;
}

export async function getShopeeSettings() {
  const prefs = await getRawStorePrefs();
  return prefs.shopee;
}

/** Cấu hình cửa hàng (1 dòng id='default'). Trả mặc định nếu chưa có. */
export async function getStoreSettings(): Promise<StoreSettings> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
  if (!row) return { ...DEFAULTS, prefs: sanitizeStorePrefsForClient(DEFAULTS.prefs) };
  return {
    name: row.name, address: row.address, phone: row.phone, taxCode: row.taxCode,
    industry: row.industry, currency: row.currency, locale: row.locale, onboarded: row.onboarded,
    prefs: sanitizeStorePrefsForClient(parseStorePrefs(row.prefs)),
  };
}

/** Danh sách nhân viên (profiles). */
export async function getStaff() {
  return db
    .select({ id: profiles.id, fullName: profiles.fullName, phone: profiles.phone, role: profiles.role, isActive: profiles.isActive, createdAt: profiles.createdAt })
    .from(profiles)
    .orderBy(asc(profiles.fullName));
}
export type StaffRow = Awaited<ReturnType<typeof getStaff>>[number];

export async function getPaymentBankAccounts() {
  const rows = await db
    .select()
    .from(paymentBankAccounts)
    .orderBy(asc(paymentBankAccounts.provider), asc(paymentBankAccounts.bankCode), asc(paymentBankAccounts.accountNumber));
  return rows.map(({ webhookSecret, apiKey, ...row }) => ({
    ...row,
    webhookSecretSet: Boolean(webhookSecret),
    apiKeySet: Boolean(apiKey),
  }));
}
export type PaymentBankAccountRow = Awaited<ReturnType<typeof getPaymentBankAccounts>>[number];
