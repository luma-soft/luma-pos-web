import { z } from "zod";

export const storeSettingsSchema = z.object({
  name: z.string().max(200).default(""),
  address: z.string().max(300).default(""),
  phone: z.string().max(30).default(""),
  taxCode: z.string().max(30).default(""),
  industry: z.string().max(40).default("grocery"),
  currency: z.string().max(10).default("VND"),
  locale: z.string().max(10).default("vi-VN"),
});
export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;

export const STAFF_ROLES = ["owner", "manager", "cashier", "warehouse"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/* ── Operational prefs (Tax / Payments / Notifications / Hardware) — lưu jsonb store_settings.prefs ── */

export const PAYMENT_METHODS = ["cash", "qr", "momo", "zalopay", "vnpay", "card"] as const;
export const NOTIF_TYPES = ["lowStock", "stagnant", "shiftClose", "einvoiceError", "syncDone"] as const;
export const NOTIF_CHANNELS = ["zalo", "email", "inApp", "sms"] as const;
export const PAPER_SIZES = ["K80", "K57", "A5", "A4"] as const;
export const AI_PROVIDERS = ["openai", "deepseek", "gemini"] as const;
export const AI_TEXT_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4.1-nano",
  "deepseek-chat",
  "deepseek-reasoner",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
] as const;
export const AI_VISION_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano", "gemini-2.5-flash", "gemini-2.5-pro"] as const;
export const AI_ATTACHMENT_BUCKETS = ["ai-attachments", "ai-pos-attachments", "luma-ai-attachments"] as const;

const taxPrefs = z.object({
  defaultRate: z.number().min(0).max(100).default(8),
  priceIncludesTax: z.boolean().default(false),
  einvoiceEnabled: z.boolean().default(false),
  einvoiceProvider: z.string().max(40).default("VNPT"),
  einvoiceTaxId: z.string().max(30).default(""),
});

const paymentPrefs = z.object({
  cash: z.boolean().default(true),
  qr: z.boolean().default(true),
  momo: z.boolean().default(false),
  zalopay: z.boolean().default(false),
  vnpay: z.boolean().default(false),
  card: z.boolean().default(false),
});

const notificationPrefs = z.object({
  lowStock: z.boolean().default(true),
  stagnant: z.boolean().default(true),
  shiftClose: z.boolean().default(true),
  einvoiceError: z.boolean().default(true),
  syncDone: z.boolean().default(false),
  channels: z.object({
    zalo: z.boolean().default(true),
    email: z.boolean().default(true),
    inApp: z.boolean().default(true),
    sms: z.boolean().default(false),
  }).default({ zalo: true, email: true, inApp: true, sms: false }),
});

const hardwarePrefs = z.object({
  paperSize: z.enum(PAPER_SIZES).default("K80"),
  autoPrint: z.boolean().default(false),
  openDrawer: z.boolean().default(true),
  printEinvoiceQr: z.boolean().default(true),
});

const appPrefs = z.object({
  biometricAuth: z.boolean().default(true),
  offlineMode: z.boolean().default(true),
});

const posPrefs = z.object({
  showProjectFields: z.boolean().default(false),
});

const aiPrefs = z.object({
  provider: z.enum(AI_PROVIDERS).default("gemini"),
  textModel: z.string().max(80).default("gemini-2.5-flash"),
  visionModel: z.string().max(80).default("gemini-2.5-flash"),
  openaiApiKey: z.string().max(500).default(""),
  openaiApiKeySet: z.boolean().default(false),
  openaiVisionModel: z.string().max(80).default("gemini-2.5-flash"),
  attachmentsBucket: z.string().max(80).default("ai-attachments"),
  monthlyUsageLimit: z.number().int().min(0).max(100000).default(1000),
  showFloatingLauncher: z.boolean().default(true),
});

const zaloPrefs = z.object({
  enabled: z.boolean().default(false),
  oaId: z.string().trim().max(80).default(""),
  appId: z.string().trim().max(80).default(""),
  appSecret: z.string().trim().max(500).default(""),
  appSecretSet: z.boolean().default(false),
  accessToken: z.string().trim().max(2000).default(""),
  accessTokenSet: z.boolean().default(false),
  refreshToken: z.string().trim().max(2000).default(""),
  refreshTokenSet: z.boolean().default(false),
  webhookSecret: z.string().trim().max(500).default(""),
  webhookSecretSet: z.boolean().default(false),
  portalTemplateId: z.string().trim().max(80).default(""),
  invoiceTemplateId: z.string().trim().max(80).default(""),
  debtTemplateId: z.string().trim().max(80).default(""),
});

export const storePrefsSchema = z.object({
  tax: taxPrefs.default({ defaultRate: 8, priceIncludesTax: false, einvoiceEnabled: false, einvoiceProvider: "VNPT", einvoiceTaxId: "" }),
  payments: paymentPrefs.default({ cash: true, qr: true, momo: false, zalopay: false, vnpay: false, card: false }),
  notifications: notificationPrefs.default({ lowStock: true, stagnant: true, shiftClose: true, einvoiceError: true, syncDone: false, channels: { zalo: true, email: true, inApp: true, sms: false } }),
  hardware: hardwarePrefs.default({ paperSize: "K80", autoPrint: false, openDrawer: true, printEinvoiceQr: true }),
  app: appPrefs.default({ biometricAuth: true, offlineMode: true }),
  pos: posPrefs.default({ showProjectFields: false }),
  ai: aiPrefs.default({
    provider: "gemini",
    textModel: "gemini-2.5-flash",
    visionModel: "gemini-2.5-flash",
    openaiApiKey: "",
    openaiApiKeySet: false,
    openaiVisionModel: "gemini-2.5-flash",
    attachmentsBucket: "ai-attachments",
    monthlyUsageLimit: 1000,
    showFloatingLauncher: true,
  }),
  zalo: zaloPrefs.default({
    enabled: false,
    oaId: "",
    appId: "",
    appSecret: "",
    appSecretSet: false,
    accessToken: "",
    accessTokenSet: false,
    refreshToken: "",
    refreshTokenSet: false,
    webhookSecret: "",
    webhookSecretSet: false,
    portalTemplateId: "",
    invoiceTemplateId: "",
    debtTemplateId: "",
  }),
});
export type StorePrefs = z.infer<typeof storePrefsSchema>;

/** Đầu vào cập nhật từng phần (mỗi section gửi slice của nó). */
export const storePrefsPatchSchema = storePrefsSchema.omit({ ai: true }).partial();
export type StorePrefsPatch = z.infer<typeof storePrefsPatchSchema>;

/** Parse prefs lưu trong DB → đầy đủ field (điền default cho field thiếu). */
export function parseStorePrefs(raw: unknown): StorePrefs {
  return storePrefsSchema.parse(raw ?? {});
}

export const aiSettingsInputSchema = z.object({
  provider: z.enum(AI_PROVIDERS).default("gemini"),
  textModel: z.enum(AI_TEXT_MODELS).default("gemini-2.5-flash"),
  visionModel: z.enum(AI_VISION_MODELS).default("gemini-2.5-flash"),
  openaiApiKey: z.string().max(500).optional(),
  clearOpenaiApiKey: z.boolean().default(false),
  openaiVisionModel: z.enum(AI_VISION_MODELS).default("gemini-2.5-flash"),
  attachmentsBucket: z.enum(AI_ATTACHMENT_BUCKETS).default("ai-attachments"),
  monthlyUsageLimit: z.number().int().min(0).max(100000).default(1000),
  showFloatingLauncher: z.boolean().default(true),
});
export type AiSettingsInput = z.input<typeof aiSettingsInputSchema>;

export const zaloSettingsInputSchema = z.object({
  enabled: z.boolean().default(false),
  oaId: z.string().trim().max(80).default(""),
  appId: z.string().trim().max(80).default(""),
  appSecret: z.string().trim().max(500).optional(),
  clearAppSecret: z.boolean().default(false),
  accessToken: z.string().trim().max(2000).optional(),
  clearAccessToken: z.boolean().default(false),
  refreshToken: z.string().trim().max(2000).optional(),
  clearRefreshToken: z.boolean().default(false),
  webhookSecret: z.string().trim().max(500).optional(),
  clearWebhookSecret: z.boolean().default(false),
  portalTemplateId: z.string().trim().max(80).default(""),
  invoiceTemplateId: z.string().trim().max(80).default(""),
  debtTemplateId: z.string().trim().max(80).default(""),
});
export type ZaloSettingsInput = z.input<typeof zaloSettingsInputSchema>;

export const paymentBankAccountInputSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.literal("sepay").default("sepay"),
  bankCode: z.string().trim().min(1).max(40),
  gateway: z.string().trim().max(80).optional(),
  accountNumber: z.string().trim().min(1).max(80),
  subAccount: z.string().trim().max(80).optional(),
  accountName: z.string().trim().min(1).max(200),
  isDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
  webhookEnabled: z.boolean().default(true),
  webhookSecret: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
});
export type PaymentBankAccountInput = z.input<typeof paymentBankAccountInputSchema>;
