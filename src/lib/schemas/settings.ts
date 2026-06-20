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

export const storePrefsSchema = z.object({
  tax: taxPrefs.default({ defaultRate: 8, priceIncludesTax: false, einvoiceEnabled: false, einvoiceProvider: "VNPT", einvoiceTaxId: "" }),
  payments: paymentPrefs.default({ cash: true, qr: true, momo: false, zalopay: false, vnpay: false, card: false }),
  notifications: notificationPrefs.default({ lowStock: true, stagnant: true, shiftClose: true, einvoiceError: true, syncDone: false, channels: { zalo: true, email: true, inApp: true, sms: false } }),
  hardware: hardwarePrefs.default({ paperSize: "K80", autoPrint: false, openDrawer: true, printEinvoiceQr: true }),
  app: appPrefs.default({ biometricAuth: true, offlineMode: true }),
});
export type StorePrefs = z.infer<typeof storePrefsSchema>;

/** Đầu vào cập nhật từng phần (mỗi section gửi slice của nó). */
export const storePrefsPatchSchema = storePrefsSchema.partial();
export type StorePrefsPatch = z.infer<typeof storePrefsPatchSchema>;

/** Parse prefs lưu trong DB → đầy đủ field (điền default cho field thiếu). */
export function parseStorePrefs(raw: unknown): StorePrefs {
  return storePrefsSchema.parse(raw ?? {});
}
