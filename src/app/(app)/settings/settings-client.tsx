"use client";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, KeyRound, Loader2, MessageCircle, Pencil, Plus, Power, Printer, Save, Star, Trash2, X } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileTopBar, TouchTargetToggle } from "@/components/mobile-ui";
import { Select } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/tabs";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { cn, formatCurrency } from "@/lib/utils";
import { normalizeSearch } from "@/lib/normalize";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { settingsTextByFlag } from "@/lib/i18n/settings-text";
import { useAppDataQuery } from "@/components/use-app-data-query";
import {
  deletePaymentBankAccount,
  loadSettingsAiUsage,
  loadSettingsPaymentBankAccounts,
  loadSettingsStaff,
  savePaymentBankAccount,
  setDefaultPaymentBankAccount,
  setPaymentBankAccountEnabled,
  testAiProvider,
  updateAiSettings,
  updateShopeeSettings,
  updateZaloSettings,
  updateStoreSettings,
  updateStaffRole,
  setStaffActive,
  updateStorePrefs,
  updateCameraQuoteSettings,
} from "@/lib/actions/settings";
import type { PaymentBankAccountRow, StoreSettings, StaffRow } from "@/lib/data/settings";
import type { CameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import {
  cameraQuoteMemoryCapacity,
  cameraQuotePrice,
  groupCameraQuoteCardsByCapacity,
  resolveCameraIpQuoteDefaults,
  resolveCameraQuoteDefaults,
} from "@/lib/camera-quote-settings";
import {
  CAMERA_IP_QUOTE_CAMERA_TYPES,
  CAMERA_IP_QUOTE_LEGACY_SKUS,
  CAMERA_IP_QUOTE_STORAGE_SIZES,
} from "@/lib/data/camera-ip-quote";
import {
  AI_PROVIDERS,
  AI_TEXT_MODELS,
  AI_VISION_MODELS,
  STAFF_ROLES,
  PAPER_SIZES,
  TAXPAYER_TYPES,
  TAX_CALCULATION_METHODS,
  TAX_FILING_FREQUENCIES,
  VAT_TREATMENTS,
  type StaffRole,
  type PaymentBankAccountInput,
  type StorePrefs,
} from "@/lib/schemas/settings";
import {
  configurableRolesForNotificationCategory,
  notificationRoutingPolicy,
} from "@/lib/notifications/routing-policy";
import {
  notificationCategories,
  type NotificationCategory,
} from "@/lib/notifications/contracts";
import { applyDirectTaxPreset, DIRECT_TAX_PRESETS, DIRECT_TAX_REDUCTION_PERCENT } from "@/lib/tax/direct-tax";

/* ── sample data (design preview — chưa nối backend) ── */
const ROLE_LABELS: Record<string, string> = {
  owner: "owner", manager: "manager", cashier: "cashier", stock: "stock", accountant: "accountant",
};
const PERMS: { key: string; roles: Record<string, boolean> }[] = [
  { key: "processSales", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { key: "applyDiscount", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { key: "priceOverride", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { key: "processRefund", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { key: "voidDeleteInvoice", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { key: "editProducts", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { key: "stockInbound", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { key: "viewReports", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: true } },
  { key: "settingsAccess", roles: { owner: true, manager: false, cashier: false, stock: false, accountant: false } },
];
const DEVICES = [
  { ico: "🖨️", name: "XPrinter XP-N260L", labelKey: "thermalPrinter", status: "connected", detail: "USB · COM3" },
  { ico: "📷", name: "Honeywell Voyager 1250g", labelKey: "barcodeScanner", status: "connected", detail: "USB HID · Wedge" },
  { ico: "🗃️", name: "APG Vasario 1416", labelKey: "cashDrawer", status: "connected", detail: "Triggered via printer" },
  { ico: "⚖️", name: "CAS SW-1S", labelKey: "weighingScale", status: "disconnected", detail: "COM4 · not responding" },
  { ico: "💳", name: "POS terminal / SoftPOS", labelKey: "cardReader", status: "unconfigured", detail: "Configure in Payments" },
];
const PAYMENTS = [
  { ico: "💵", labelKey: "cash", id: "cash", enabled: true, color: "#15803D", note: "Always available · change calc built-in" },
  { ico: "📱", labelKey: "qr", id: "qr", enabled: true, color: "#1D4ED8", note: "Dynamic QR · auto-confirm · Napas" },
  { ico: "🟣", labelKey: "momo", id: "momo", enabled: true, color: "#A50064", note: "Deep-link + webhook · timeout 90s" },
  { ico: "🔵", labelKey: "zalopay", id: "zalopay", enabled: false, color: "#006AFF", note: "Not yet configured — tap to set up" },
  { ico: "🔴", labelKey: "vnpay", id: "vnpay", enabled: false, color: "#CC0000", note: "Not yet configured — tap to set up" },
  { ico: "💳", labelKey: "card", id: "card", enabled: false, color: "#374151", note: "Connect card reader in Hardware first" },
  { ico: "🧾", labelKey: "credit", id: "credit", enabled: true, color: "#B45309", note: "Saved customer required · server-owned debt" },
];
const VIETQR_BANKS = [
  { code: "ICB", bin: "970415", shortName: "VietinBank", name: "Ngân hàng TMCP Công thương Việt Nam", logo: "https://api.vietqr.io/img/ICB.png", aliases: [] },
  { code: "VCB", bin: "970436", shortName: "Vietcombank", name: "Ngân hàng TMCP Ngoại Thương Việt Nam", logo: "https://api.vietqr.io/img/VCB.png", aliases: [] },
  { code: "MB", bin: "970422", shortName: "MBBank", name: "Ngân hàng TMCP Quân đội", logo: "https://api.vietqr.io/img/MB.png", aliases: [] },
  { code: "ACB", bin: "970416", shortName: "ACB", name: "Ngân hàng TMCP Á Châu", logo: "https://api.vietqr.io/img/ACB.png", aliases: [] },
  { code: "VPB", bin: "970432", shortName: "VPBank", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", logo: "https://api.vietqr.io/img/VPB.png", aliases: [] },
  { code: "TPB", bin: "970423", shortName: "TPBank", name: "Ngân hàng TMCP Tiên Phong", logo: "https://api.vietqr.io/img/TPB.png", aliases: [] },
  { code: "MSB", bin: "970426", shortName: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam", logo: "https://api.vietqr.io/img/MSB.png", aliases: [] },
  { code: "LPB", bin: "970449", shortName: "LienVietPostBank", name: "Ngân hàng TMCP Lộc Phát Việt Nam", logo: "https://api.vietqr.io/img/LPB.png", aliases: ["LPBank"] },
  { code: "VCCB", bin: "970454", shortName: "VietCapitalBank", name: "Ngân hàng TMCP Bản Việt", logo: "https://api.vietqr.io/img/VCCB.png", aliases: ["BVBank"] },
  { code: "BIDV", bin: "970418", shortName: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", logo: "https://api.vietqr.io/img/BIDV.png", aliases: [] },
  { code: "STB", bin: "970403", shortName: "Sacombank", name: "Ngân hàng TMCP Sài Gòn Tài Lộc", logo: "https://api.vietqr.io/img/STB.png", aliases: [] },
  { code: "VIB", bin: "970441", shortName: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam", logo: "https://api.vietqr.io/img/VIB.png", aliases: [] },
  { code: "HDB", bin: "970437", shortName: "HDBank", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh", logo: "https://api.vietqr.io/img/HDB.png", aliases: [] },
  { code: "SEAB", bin: "970440", shortName: "SeABank", name: "Ngân hàng TMCP Đông Nam Á", logo: "https://api.vietqr.io/img/SEAB.png", aliases: [] },
  { code: "SHBVN", bin: "970424", shortName: "ShinhanBank", name: "Ngân hàng TNHH MTV Shinhan Việt Nam", logo: "https://api.vietqr.io/img/SHBVN.png", aliases: [] },
  { code: "VBA", bin: "970405", shortName: "Agribank", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", logo: "https://api.vietqr.io/img/VBA.png", aliases: [] },
  { code: "TCB", bin: "970407", shortName: "Techcombank", name: "Ngân hàng TMCP Kỹ thương Việt Nam", logo: "https://api.vietqr.io/img/TCB.png", aliases: [] },
  { code: "BAB", bin: "970409", shortName: "BacABank", name: "Ngân hàng TMCP Bắc Á", logo: "https://api.vietqr.io/img/BAB.png", aliases: [] },
  { code: "ABB", bin: "970425", shortName: "ABBANK", name: "Ngân hàng TMCP An Bình", logo: "https://api.vietqr.io/img/ABB.png", aliases: [] },
  { code: "EIB", bin: "970431", shortName: "Eximbank", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam", logo: "https://api.vietqr.io/img/EIB.png", aliases: [] },
  { code: "PBVN", bin: "970439", shortName: "PublicBank", name: "Ngân hàng TNHH MTV Public Việt Nam", logo: "https://api.vietqr.io/img/PBVN.png", aliases: [] },
  { code: "OCB", bin: "970448", shortName: "OCB", name: "Ngân hàng TMCP Phương Đông", logo: "https://api.vietqr.io/img/OCB.png", aliases: [] },
  { code: "KLB", bin: "970452", shortName: "KienLongBank", name: "Ngân hàng TMCP Kiên Long", logo: "https://api.vietqr.io/img/KLB.png", aliases: [] },
] as const;
type VietQrBank = (typeof VIETQR_BANKS)[number];
const VAT_RATES = [
  { rate: 0 },
  { rate: 5 },
  { rate: 8 },
  { rate: 10 },
];
const AI_PROVIDER_OPTIONS = AI_PROVIDERS.map((value) => ({
  value,
  label: value === "openai" ? "OpenAI" : value === "deepseek" ? "DeepSeek" : "Gemini",
  hint: value === "openai" ? "Text + vision" : value === "deepseek" ? "Text planner only" : "Text + vision",
}));
const AI_TEXT_MODEL_OPTIONS = AI_TEXT_MODELS.map((value) => ({
  value,
  label: value,
  hint: value === "gpt-4.1-mini" || value === "gemini-2.5-flash" || value === "deepseek-chat"
    ? "Recommended"
    : value.includes("reasoner") || value.includes("pro") || value === "gpt-4.1"
      ? "Higher accuracy"
      : "Fastest / lowest cost",
}));
const AI_MODEL_OPTIONS = AI_VISION_MODELS.map((value) => ({
  value,
  label: value,
  hint: value === "gpt-4.1-mini"
    ? "Recommended"
    : value === "gpt-4.1"
      ? "Higher accuracy"
      : "Fastest / lowest cost",
}));
type AiVisionModel = (typeof AI_VISION_MODELS)[number];
type AiProvider = (typeof AI_PROVIDERS)[number];
type AiTextModel = (typeof AI_TEXT_MODELS)[number];
type AiUsageStatus = {
  period: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};
type AiProviderTestKind = "text" | "vision";
type AiProviderTestResult = {
  kind: AiProviderTestKind;
  provider: string;
  textModel: string;
  visionModel: string;
  keyConfigured: boolean;
  textPlanning: boolean;
  visionOcr: boolean;
  ok: boolean;
  message: string;
  testedAt: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};
function coerceAiProvider(value: string): AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider) ? value as AiProvider : "gemini";
}
function coerceAiTextModel(value: string): AiTextModel {
  return AI_TEXT_MODELS.includes(value as AiTextModel) ? value as AiTextModel : "gemini-2.5-flash";
}
function coerceAiVisionModel(value: string): AiVisionModel {
  return AI_VISION_MODELS.includes(value as AiVisionModel) ? value as AiVisionModel : "gemini-2.5-flash";
}
function defaultTextModelForProvider(provider: AiProvider): AiTextModel {
  if (provider === "deepseek") return "deepseek-chat";
  if (provider === "gemini") return "gemini-2.5-flash";
  return "gpt-4.1-mini";
}
function defaultVisionModelForProvider(provider: AiProvider): AiVisionModel {
  if (provider === "gemini") return "gemini-2.5-flash";
  return "gpt-4.1-mini";
}
function providerKeyPlaceholder(provider: AiProvider, keySet: boolean, L: boolean) {
  if (keySet) return settingsTextByFlag(L, "legacy.01c9fa6b03ac");
  if (provider === "gemini") return "AIza...";
  if (provider === "openai") return "sk-...";
  return "sk-... or DeepSeek key";
}
function providerKeyHelp(provider: AiProvider, L: boolean) {
  if (provider === "gemini") {
    return settingsTextByFlag(L, "legacy.3b38bbf86122");
  }
  if (provider === "deepseek") {
    return settingsTextByFlag(L, "legacy.bfdf4f758afa");
  }
  return settingsTextByFlag(L, "legacy.d1145a562bef");
}
function formatAiTestMessage(message: string, L: boolean) {
  const map: Record<string, string> = {
    missing_api_key: "missingApiKey",
    unsupported_vision: "unsupportedVision",
    unsupported_text_planning: "unsupportedTextPlanning",
  };
  return map[message] ? settingsTextByFlag(L, `ui.aiTest.${map[message]}`) : message;
}

type SectionId = "store" | "staff" | "pos" | "cameraQuote" | "hardware" | "payments" | "print" | "promotions" | "tax" | "notifications" | "zalo" | "shopee" | "ai";

const NAV: { groupKey: string; items: { id: SectionId; ico: string; labelKey: string; badge?: string }[] }[] = [
  { groupKey: "store", items: [
    { id: "store", ico: "🏪", labelKey: "store" },
    { id: "staff", ico: "👤", labelKey: "staff" },
  ] },
  { groupKey: "operations", items: [
    { id: "pos", ico: "🛒", labelKey: "pos" },
    { id: "cameraQuote", ico: "📷", labelKey: "cameraQuote" },
    { id: "hardware", ico: "🖨️", labelKey: "hardware" },
    { id: "payments", ico: "💳", labelKey: "payments" },
    { id: "print", ico: "📄", labelKey: "print", badge: "15.1" },
    { id: "promotions", ico: "%", labelKey: "promotions" },
  ] },
  { groupKey: "compliance", items: [
    { id: "tax", ico: "📋", labelKey: "tax" },
  ] },
  { groupKey: "system", items: [
    { id: "notifications", ico: "🔔", labelKey: "notifications" },
    { id: "zalo", ico: "💬", labelKey: "zalo" },
    ...(ONLINE_SALES_ENABLED
      ? [{ id: "shopee" as const, ico: "🧩", labelKey: "shopee" }]
      : []),
    { id: "ai", ico: "✨", labelKey: "ai" },
  ] },
];
const SEC_META: Record<SectionId, { titleKey: string; subtitleKey: string }> = {
  store: { titleKey: "store", subtitleKey: "store" },
  staff: { titleKey: "staff", subtitleKey: "staff" },
  pos: { titleKey: "pos", subtitleKey: "pos" },
  cameraQuote: { titleKey: "cameraQuote", subtitleKey: "cameraQuote" },
  hardware: { titleKey: "hardware", subtitleKey: "hardware" },
  payments: { titleKey: "payments", subtitleKey: "payments" },
  print: { titleKey: "print", subtitleKey: "print" },
  promotions: { titleKey: "promotions", subtitleKey: "promotions" },
  tax: { titleKey: "tax", subtitleKey: "tax" },
  notifications: { titleKey: "notifications", subtitleKey: "notifications" },
  zalo: { titleKey: "zalo", subtitleKey: "zalo" },
  shopee: { titleKey: "shopee", subtitleKey: "shopee" },
  ai: { titleKey: "ai", subtitleKey: "ai" },
};

function isVisibleSection(id: SectionId) {
  return ONLINE_SALES_ENABLED || id !== "shopee";
}

/* ── helpers (luma classes mapping prototype) ── */
function Card({ title, vi, action, children }: { title: string; vi: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-card shadow-e2 mb-4">
      <div className="px-4.5 py-3 border-b border-border-soft bg-canvas rounded-t-card flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold">{title}</div>
          <div className="text-[10px] italic text-slate-400 mt-px">{vi}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
const FL = "text-[9px] font-bold uppercase tracking-wide text-slate-500";
const rightHeader = (label: string) => <span className="block w-full text-right">{label}</span>;
const FI = "min-h-11 w-full px-[11px] py-[9px] bg-canvas border-[1.5px] border-border rounded-[10px] text-[13px] focus:border-primary-500 focus:outline-none lg:min-h-0";
const ROW = "flex min-h-11 items-center justify-between gap-3 px-3.5 py-2.5 bg-canvas rounded-[10px] border border-border-soft min-w-11";
const btnS = "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border-soft px-3 text-xs font-semibold transition hover:bg-surface-2";
const btnF = "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white transition hover:brightness-110";
const searchableTouch = "[&>button]:h-11 lg:[&>button]:h-10";

async function readSettingsStaff() {
  const result = await loadSettingsStaff();
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function readSettingsBankAccounts() {
  const result = await loadSettingsPaymentBankAccounts();
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function readSettingsAiUsage() {
  const result = await loadSettingsAiUsage();
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function SettingsClient({
  store,
  canManage,
  canEditAi,
  notificationChannels,
  initialTab,
  promotionsContent,
  cameraQuoteOptions,
}: {
  store: StoreSettings;
  canManage: boolean;
  canEditAi: boolean;
  notificationChannels: { id: string; configured: boolean }[];
  initialTab?: string;
  promotionsContent: React.ReactNode;
  cameraQuoteOptions: CameraQuoteFormOptions;
}) {
  const locale = useLocale();
  const tSettings = useTranslations("settings");
  const L = locale === "vi";
  const normalizedInitialTab = initialTab
    && SEC_META[initialTab as SectionId]
    && isVisibleSection(initialTab as SectionId)
    ? initialTab as SectionId
    : null;
  const [active, setActive] = useState<SectionId>(normalizedInitialTab ?? "store");
  const { state: staffQuery } = useAppDataQuery(active === "staff" ? "staff" : null, readSettingsStaff);
  const { state: bankQuery } = useAppDataQuery(active === "payments" ? "payments" : null, readSettingsBankAccounts);
  const { state: usageQuery } = useAppDataQuery(active === "ai" ? "ai" : null, readSettingsAiUsage);
  const staff = staffQuery?.data;
  const bankAccounts = bankQuery?.data;
  const aiUsage = usageQuery?.data;
  const lazyLoading = { staff: staffQuery?.loading, payments: bankQuery?.loading, ai: usageQuery?.loading };
  const lazyError = { staff: staffQuery?.error, payments: bankQuery?.error, ai: usageQuery?.error };
  useEffect(() => {
    if (normalizedInitialTab) return;
    const saved = localStorage.getItem("lp-settings-active") as SectionId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client sync of persisted section (SSR-safe)
    if (saved && SEC_META[saved] && isVisibleSection(saved)) setActive(saved);
  }, [normalizedInitialTab]);
  const pick = (id: SectionId) => { setActive(id); localStorage.setItem("lp-settings-active", id); };
  return (
    <div className="flex h-dvh overflow-hidden">
      {/* settings nav */}
      <nav className="w-55 shrink-0 bg-surface border-r border-border overflow-y-auto hidden md:flex flex-col">
        <div className="px-4 py-3.5 border-b border-border">
          <div className="text-sm font-extrabold">{settingsTextByFlag(L, "legacy.55a9ce6867eb")}</div>
          <div className="text-[10px] italic text-slate-400 mt-0.5">{settingsTextByFlag(L, "legacy.4511c97881b0")}</div>
        </div>
        {NAV.map((grp, gi) => (
          <div key={gi}>
            <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{settingsTextByFlag(L, `ui.nav.groups.${grp.groupKey}`)}</div>
            {grp.items.map((it) => (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 border-l-2 px-3.5 py-2 text-xs font-semibold transition lg:min-h-0",
                  active === it.id
                    ? "bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border-primary-600"
                    : "text-slate-500 border-transparent hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
                )}
              >
                <span className="w-4.5 text-center text-sm shrink-0">{it.ico}</span>
                <span className="flex-1 text-left">{settingsTextByFlag(L, `ui.nav.items.${it.labelKey}`)}</span>
                {it.badge && <span className="text-[8px] bg-in-soft text-in border border-in/30 rounded-full px-1.5 py-px">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopBar
          className="md:hidden"
          title={settingsTextByFlag(L, `ui.sections.${active}.title`)}
          subtitle={settingsTextByFlag(L, `ui.sections.${active}.subtitle`)}
          bottom={
            <Select
              value={active}
              onChange={(e) => pick(e.target.value as SectionId)}
              options={NAV.flatMap((g) => g.items).map((it) => ({ value: it.id, label: settingsTextByFlag(L, `ui.nav.items.${it.labelKey}`) }))}
              aria-label={settingsTextByFlag(L, "legacy.21fca9114fb3")}
              className="min-h-11"
            />
          }
        />
        <div className={cn(
          "flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] md:px-7",
          active === "tax" ? "pt-3 md:pt-0 md:pb-6" : "py-3 md:py-6",
        )}>
        <div className={cn("hidden md:block", active === "tax" && "md:pt-4")}>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-primary-600">
            {tSettings("breadcrumb.settings")} · {tSettings(`breadcrumb.${active}`)}
          </div>
          {active !== "payments" && active !== "tax" && <h1 className="text-xl font-extrabold tracking-tight">{settingsTextByFlag(L, `ui.sections.${active}.title`)}</h1>}
        </div>

        {active === "store" && <StoreSection L={L} store={store} canManage={canManage} />}
        {active === "staff" && (staff ? <StaffSection L={L} staff={staff} canManage={canManage} /> : <LazySectionState L={L} loading={Boolean(lazyLoading.staff)} error={lazyError.staff} />)}
        {active === "pos" && <PosSettingsSection L={L} prefs={store.prefs.pos} canManage={canManage} />}
        {active === "cameraQuote" && <CameraQuoteSettingsSection prefs={store.prefs.cameraQuote} options={cameraQuoteOptions} canManage={canManage} />}
        {active === "hardware" && <HardwareSection L={L} prefs={store.prefs.hardware} canManage={canManage} />}
        {active === "payments" && <PaymentsSection L={L} prefs={store.prefs.payments} canManage={canManage} bankAccounts={bankAccounts ?? []} accountsLoading={Boolean(lazyLoading.payments)} accountsError={lazyError.payments} />}
        {active === "print" && <PrintSection L={L} />}
        {active === "promotions" && promotionsContent}
        {active === "tax" && <TaxSection L={L} prefs={store.prefs.tax} canManage={canManage} />}
        {active === "notifications" && <NotificationsSection L={L} prefs={store.prefs.notifications} canManage={canManage} availableChannels={notificationChannels} />}
        {active === "zalo" && <ZaloSection L={L} prefs={store.prefs.zalo} canEdit={canEditAi} />}
        {ONLINE_SALES_ENABLED && active === "shopee" && <ShopeeSettingsSection L={L} prefs={store.prefs.shopee} canEdit={canEditAi} />}
        {active === "ai" && (aiUsage ? <AiSection L={L} prefs={store.prefs.ai} canEdit={canEditAi} usage={aiUsage} /> : <LazySectionState L={L} loading={Boolean(lazyLoading.ai)} error={lazyError.ai} />)}
        </div>
      </div>
    </div>
  );
}

function LazySectionState({ L, loading, error }: { L: boolean; loading: boolean; error?: string }) {
  return (
    <Card title={settingsTextByFlag(L, "legacy.3184a6c399d7")} vi={settingsTextByFlag(L, "legacy.62887f198996")}>
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        <span>{error ? (settingsTextByFlag(L, "legacy.5a6881c9222f")) : (settingsTextByFlag(L, "legacy.d4fa8a2f9d26"))}</span>
      </div>
    </Card>
  );
}

const INDUSTRY_OPTS = ["grocery", "cafe", "restaurant", "fashion", "electronics", "cosmetics", "books", "services", "petshop", "mobile", "construction"] as const;
const ROLE_TEXT: Record<string, string> = {
  owner: "owner", manager: "manager", cashier: "cashier", warehouse: "warehouse", technician: "technician",
};
const ROLE_PILL: Record<string, string> = {
  owner: "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
  manager: "bg-in-soft text-in", cashier: "bg-ok-soft text-ok", warehouse: "bg-warn-soft text-warn",
};
const AVATAR_COLORS = ["#0C7B6B", "#1D4ED8", "#B45309", "#6B6F76", "#9CA0A8"];

function StoreSection({ L, store, canManage }: { L: boolean; store: StoreSettings; canManage: boolean }) {
  const [form, setForm] = useState(store);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => { setForm((p) => ({ ...p, [k]: v })); setDirty(true); setSaved(false); };
  const industryOpts = INDUSTRY_OPTS.map((value) => ({ value, label: settingsTextByFlag(L, `ui.industries.${value}`) }));
  const currencyOpts = [{ value: "VND", label: settingsTextByFlag(L, "ui.currency.vnd") }, { value: "USD", label: settingsTextByFlag(L, "ui.currency.usd") }];
  function save() { start(async () => { const res = await updateStoreSettings(form); if (res.ok) { setDirty(false); setSaved(true); } }); }
  return (
    <Card title={settingsTextByFlag(L, "legacy.0c4a17131dac")} vi={settingsTextByFlag(L, "legacy.2b5c7ad93928")}>
      <div className="p-4.5 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.a8d9ef6d3dc5")}</span><input className={FI} value={form.name} disabled={!canManage} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.8f0bb5fb2246")}</span><input className={FI} value={form.phone} disabled={!canManage} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.4c007f9511be")}</span><input className={FI} value={form.address} disabled={!canManage} onChange={(e) => set("address", e.target.value)} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.50d1b0adcda3")}</span><input className={FI} value={form.taxCode} disabled={!canManage} onChange={(e) => set("taxCode", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.d251731ba879")}</span>
            <SearchableSelect options={industryOpts} value={form.industry} onChange={(v) => set("industry", v)} allowClear={false} disabled={!canManage} className={searchableTouch} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.b5fc197ba6f4")}</span>
            <SearchableSelect options={currencyOpts} value={form.currency} onChange={(v) => set("currency", v)} allowClear={false} disabled={!canManage} className={searchableTouch} />
          </div>
        </div>
        {canManage && (dirty || saved) && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-500 flex-1">{dirty ? (settingsTextByFlag(L, "legacy.3bf5caaee8b4")) : (settingsTextByFlag(L, "legacy.e8f6c0afb49d"))}</span>
            <button disabled={!dirty || pending} onClick={save} className={cn(btnF, "disabled:opacity-50")}>
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{settingsTextByFlag(L, "legacy.2d7e281f1bcd")}
            </button>
          </div>
        )}
        {!canManage && <p className="text-[11px] text-slate-400 italic">{settingsTextByFlag(L, "legacy.f2daa8f757fc")}</p>}
      </div>
    </Card>
  );
}

function StaffRowItem({ s, i, L, canManage }: { s: StaffRow; i: number; L: boolean; canManage: boolean }) {
  const t = useTranslations();
  const role = s.role;
  const active = s.isActive;
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function save(action: () => ReturnType<typeof updateStaffRole>) {
    setError("");
    start(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(t(result.error as never));
      } catch {
        setError(t("errors.serverError"));
      }
    });
  }
  const initial = ((s.fullName.trim().split(" ").pop() ?? "?")[0] ?? "?").toUpperCase();
  return (
    <tr className="grid grid-cols-2 gap-3 border-b border-border-soft p-3 last:border-0 hover:bg-surface-2 md:table-row md:p-0">
      <td className="col-span-2 block p-0 md:table-cell md:px-3 md:py-2.5"><div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-extrabold text-white shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{initial}</span>
        <span className="font-bold text-xs">{s.fullName}</span>
      </div>{error && <p role="alert" className="mt-1 text-xs text-er">{error}</p>}</td>
      <td className="block p-0 md:table-cell md:px-3 md:py-2.5">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 md:hidden">{settingsTextByFlag(L, "legacy.500066278f54")}</div>
        {canManage ? (
          <Select
            value={role}
            onChange={(e) => { const r = e.target.value as StaffRole; save(() => updateStaffRole(s.id, r)); }}
            disabled={pending}
            size="sm"
            options={STAFF_ROLES.map((r) => ({ value: r, label: settingsTextByFlag(L, `ui.roles.${ROLE_TEXT[r] ?? r}`) }))}
            className="min-h-11 text-xs lg:min-h-0"
          />
        ) : <span className={cn("inline-block px-2 py-0.5 rounded-full text-[9px] font-bold", ROLE_PILL[role] ?? "bg-surface-2 text-slate-500")}>{settingsTextByFlag(L, `ui.roles.${ROLE_TEXT[role] ?? role}`)}</span>}
      </td>
      <td className="block p-0 font-mono text-[11px] text-slate-500 md:table-cell md:px-3 md:py-2.5">
        <div className="mb-1 font-sans text-[10px] font-bold uppercase tracking-wide text-slate-400 md:hidden">{settingsTextByFlag(L, "legacy.5745605d2af1")}</div>
        {s.phone ?? "—"}
      </td>
      <td className="col-span-2 flex min-h-11 items-center justify-between p-0 md:table-cell md:px-3 md:py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 md:hidden">{settingsTextByFlag(L, "legacy.81a5b063f527")}</div>
        {canManage
          ? <TouchTargetToggle checked={active} disabled={pending} onChange={(v) => save(() => setStaffActive(s.id, v))} aria-label="active" />
          : <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", active ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-400")}>{active ? (settingsTextByFlag(L, "legacy.91c275269ca2")) : (settingsTextByFlag(L, "legacy.c6878ed4526d"))}</span>}
      </td>
    </tr>
  );
}

function PosSettingsSection({ L, prefs, canManage }: { L: boolean; prefs: StorePrefs["pos"]; canManage: boolean }) {
  const [form, setForm] = useState(prefs);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setSaved(false);
  };
  function save() {
    start(async () => {
      const r = await updateStorePrefs({ pos: form });
      if (r.ok) {
        setDirty(false);
        setSaved(true);
      }
    });
  }

  return (
    <Card
      title={settingsTextByFlag(L, "legacy.22987928dd72")}
      vi={settingsTextByFlag(L, "legacy.04749a4fae6b")}
    >
      <div className="p-4.5 flex flex-col gap-3">
        <CtrlRow
          title={settingsTextByFlag(L, "legacy.d193d6dbb537")}
          desc={settingsTextByFlag(L, "legacy.6b6330bb9f31")}
          checked={form.showProjectFields}
          onChange={canManage ? (v) => set("showProjectFields", v) : undefined}
        />
        <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
      </div>
    </Card>
  );
}

type CameraQuoteProductField =
  | "indoorMaterialProductId"
  | "outdoorMaterialProductId"
  | "ptzMaterialProductId"
  | "indoorInstallationProductId"
  | "outdoorInstallationProductId"
  | "ptzInstallationProductId";

type CameraQuoteCamera = CameraQuoteFormOptions["cameras"][number];

function materializeCameraQuotePrefs(
  prefs: StorePrefs["cameraQuote"],
  options: CameraQuoteFormOptions,
): StorePrefs["cameraQuote"] {
  const defaults = resolveCameraQuoteDefaults(options, prefs);
  const cardByCapacity = new Map(
    groupCameraQuoteCardsByCapacity(options.cards).map(([capacity, cards]) => [capacity, cards]),
  );
  const memoryCardSelections = prefs.memoryCardSelections
    ?? Object.fromEntries(
      [...cardByCapacity.entries()].flatMap(([capacity, cards]) => {
        const selected = defaults.cards.find((card) => cameraQuoteMemoryCapacity(card) === capacity) ?? cards[0];
        return selected ? [[capacity, selected.id]] : [];
      }),
  );
  const memoryCardProductIds = [...new Set(Object.values(memoryCardSelections))];
  const ipDefaults = resolveCameraIpQuoteDefaults(options.ipQuoteProducts, prefs.ipQuote);
  return {
    ...prefs,
    memoryCardProductIds,
    memoryCardSelections,
    defaultMemoryCardProductId: defaults.defaultCard?.id ?? null,
    indoorMaterialProductId: defaults.indoorMaterial?.id ?? null,
    outdoorMaterialProductId: defaults.outdoorMaterial?.id ?? null,
    ptzMaterialProductId: defaults.ptzMaterial?.id ?? null,
    indoorInstallationProductId: defaults.indoorInstallation?.id ?? null,
    outdoorInstallationProductId: defaults.outdoorInstallation?.id ?? null,
    ptzInstallationProductId: defaults.ptzInstallation?.id ?? null,
    ipQuote: {
      ...prefs.ipQuote,
      cameraProductIds: Object.fromEntries(
        CAMERA_IP_QUOTE_CAMERA_TYPES.flatMap((key) => {
          const product = ipDefaults.cameras[key];
          return product ? [[key, product.id]] : [];
        }),
      ),
      recorderProductIds: Object.fromEntries(
        Object.entries(ipDefaults.recorders).flatMap(([key, product]) => product ? [[key, product.id]] : []),
      ),
      switchProductIds: Object.fromEntries(
        Object.entries(ipDefaults.switches).flatMap(([key, product]) => product ? [[key, product.id]] : []),
      ),
      storageProductIds: Object.fromEntries(
        Object.entries(ipDefaults.storage).flatMap(([key, product]) => product ? [[key, product.id]] : []),
      ),
      materialProductId: ipDefaults.material?.id ?? null,
      installationProductId: ipDefaults.installation?.id ?? null,
      cableProductId: ipDefaults.cable?.id ?? null,
      upsProductId: ipDefaults.ups?.id ?? null,
      rackProductId: ipDefaults.rack?.id ?? null,
      monitorProductId: ipDefaults.monitor?.id ?? null,
      surgeProductId: ipDefaults.surge?.id ?? null,
    },
  };
}

function CameraQuoteSettingsSection({
  prefs,
  options,
  canManage,
}: {
  prefs: StorePrefs["cameraQuote"];
  options: CameraQuoteFormOptions;
  canManage: boolean;
}) {
  const t = useTranslations("settings.cameraQuote");
  const [form, setForm] = useState(() => materializeCameraQuotePrefs(prefs, options));
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const productById = useMemo(
    () => new Map([
      ...options.cameras,
      ...options.cards,
      ...options.installations,
      ...options.materials,
      ...options.ipQuoteProducts,
    ].map((product) => [product.id, product])),
    [options],
  );
  const selectedCardIds = new Set(form.memoryCardProductIds ?? []);
  const cardGroups = groupCameraQuoteCardsByCapacity(options.cards);
  const ipProductById = new Map(options.ipQuoteProducts.map((product) => [product.id, product]));
  const ipProductOptions = (skus: readonly string[], selectedId?: string) => options.ipQuoteProducts
    .filter((product) => product.id === selectedId || (product.sku && skus.includes(product.sku)))
    .map((product) => ({ value: product.id, label: product.name, hint: product.sku }));
  const ipCameraSkus = new Set<string>(Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.camera));
  const wifiCameras = options.cameras.filter((product) => !ipCameraSkus.has(product.sku));
  const visibleCameras = wifiCameras.filter((product) =>
    `${product.name} ${product.sku}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")),
  );
  const cameraColumns: DataTableColumn<CameraQuoteCamera>[] = [
    {
      key: "product",
      label: t("wifi.product"),
      required: true,
      render: (product) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{product.name}</div>
          <div className="text-[10px] text-slate-400">{product.sku}</div>
        </div>
      ),
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("wifi.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (product) => formatCurrency(product.costPrice),
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("wifi.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (product) => (
        <MoneyInput
          aria-label={t("wifi.quotePriceAria", { product: product.name })}
          value={cameraQuotePrice(product.id, product.retailPrice, form)}
          disabled={!canManage}
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(value) => setPriceOverride(product.id, value, product.retailPrice)}
        />
      ),
      sortable: false,
    },
  ];

  function markChanged(next: StorePrefs["cameraQuote"]) {
    setForm(next);
    setDirty(true);
    setSaved(false);
    setError("");
  }

  function setPriceOverride(productId: string, value: number | null, retailPrice: number) {
    const priceOverrides = { ...form.priceOverrides };
    if (value === null || value === retailPrice) delete priceOverrides[productId];
    else priceOverrides[productId] = Math.max(0, Math.round(value));
    markChanged({ ...form, priceOverrides });
  }

  function setMemoryCardSelection(capacity: string, productId: string) {
    const memoryCardSelections = {
      ...(form.memoryCardSelections ?? {}),
      [capacity]: productId,
    };
    const memoryCardProductIds = [...new Set(Object.values(memoryCardSelections))];
    const defaultMemoryCardProductId = memoryCardProductIds.includes(form.defaultMemoryCardProductId ?? "")
      ? form.defaultMemoryCardProductId
      : memoryCardProductIds[0] ?? null;
    markChanged({ ...form, memoryCardSelections, memoryCardProductIds, defaultMemoryCardProductId });
  }

  function setProduct(field: CameraQuoteProductField, value: string) {
    markChanged({ ...form, [field]: value || null });
  }

  function setIpProductMap(
    field: "cameraProductIds" | "recorderProductIds" | "switchProductIds" | "storageProductIds",
    key: string,
    value: string,
  ) {
    markChanged({
      ...form,
      ipQuote: {
        ...form.ipQuote,
        [field]: { ...form.ipQuote[field], [key]: value },
      },
    });
  }

  function setIpProduct(field: "materialProductId" | "installationProductId" | "cableProductId" | "upsProductId" | "rackProductId" | "monitorProductId" | "surgeProductId", value: string) {
    markChanged({
      ...form,
      ipQuote: { ...form.ipQuote, [field]: value || null },
    });
  }

  function ipProduct(id: string | null | undefined) {
    return id ? ipProductById.get(id) : undefined;
  }

  function save() {
    start(async () => {
      const result = await updateCameraQuoteSettings(form);
      if (!result.ok) {
        setError(t("errors.save"));
        return;
      }
      setDirty(false);
      setSaved(true);
    });
  }

  const profileRows: Array<{
    id: "indoor" | "outdoor" | "ptz";
    label: string;
    materialField: CameraQuoteProductField;
    installationField: CameraQuoteProductField;
  }> = [
    { id: "indoor", label: t("installation.profiles.indoor"), materialField: "indoorMaterialProductId", installationField: "indoorInstallationProductId" },
    { id: "outdoor", label: t("installation.profiles.outdoor"), materialField: "outdoorMaterialProductId", installationField: "outdoorInstallationProductId" },
    { id: "ptz", label: t("installation.profiles.ptz"), materialField: "ptzMaterialProductId", installationField: "ptzInstallationProductId" },
  ];
  const memoryRows = cardGroups.map(([capacity, products]) => ({
    id: `memory-${capacity}`,
    capacity,
    products,
  }));
  const memoryColumns: DataTableColumn<(typeof memoryRows)[number]>[] = [
    {
      key: "capacity",
      label: t("memory.capacity"),
      required: true,
      width: "100px",
      render: (row) => <span className="font-extrabold text-slate-700">{row.capacity}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("memory.selected"),
      required: true,
      render: (row) => {
        const selectedId = form.memoryCardSelections?.[row.capacity] ?? row.products.find((product) => selectedCardIds.has(product.id))?.id ?? "";
        return (
          <SearchableSelect
            value={selectedId}
            options={row.products.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
            allowClear={false}
            disabled={!canManage}
            onChange={(value) => setMemoryCardSelection(row.capacity, value)}
            className={searchableTouch}
          />
        );
      },
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("memory.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (row) => {
        const selectedId = form.memoryCardSelections?.[row.capacity] ?? row.products.find((product) => selectedCardIds.has(product.id))?.id;
        const selected = selectedId ? productById.get(selectedId) : undefined;
        return selected ? formatCurrency(selected.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("memory.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (row) => {
        const selectedId = form.memoryCardSelections?.[row.capacity] ?? row.products.find((product) => selectedCardIds.has(product.id))?.id ?? "";
        const selected = selectedId ? productById.get(selectedId) : undefined;
        return (
          <MoneyInput
            aria-label={t("memory.quotePriceAria", { capacity: row.capacity })}
            value={selected ? cameraQuotePrice(selected.id, selected.retailPrice, form) : null}
            disabled={!canManage || !selected}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => selected && setPriceOverride(selected.id, value, selected.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const installationColumns: DataTableColumn<(typeof profileRows)[number]>[] = [
    {
      key: "profile",
      label: t("installation.profile"),
      required: true,
      width: "150px",
      render: (profile) => (
        <div>
          <div className="text-xs font-bold">{profile.label}</div>
          {profile.id === "ptz" && <div className="mt-1 text-[10px] text-slate-400">{t("installation.ptzHint")}</div>}
        </div>
      ),
      sortable: false,
    },
    {
      key: "itemType",
      label: t("installation.item"),
      required: true,
      width: "100px",
      render: () => <span className="text-xs font-semibold">{t("installation.material")}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("installation.product"),
      required: true,
      render: (profile) => (
        <SearchableSelect
          value={form[profile.materialField] ?? ""}
          options={options.materials.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
          allowClear={false}
          disabled={!canManage}
          onChange={(value) => setProduct(profile.materialField, value)}
          className={searchableTouch}
        />
      ),
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("installation.costPrice")),
      required: true,
      align: "right",
      width: "110px",
      render: (profile) => {
        const material = form[profile.materialField] ? productById.get(form[profile.materialField]!) : undefined;
        return material ? formatCurrency(material.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "salePrice",
      label: rightHeader(t("installation.salePrice")),
      required: true,
      align: "right",
      width: "135px",
      render: (profile) => {
        const material = form[profile.materialField] ? productById.get(form[profile.materialField]!) : undefined;
        return (
          <MoneyInput
            aria-label={t("installation.materialSaleAria", { profile: profile.label })}
            value={material ? cameraQuotePrice(material.id, material.retailPrice, form) : null}
            disabled={!canManage || !material}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => material && setPriceOverride(material.id, value, material.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const ipCameraRows = CAMERA_IP_QUOTE_CAMERA_TYPES.map((key) => ({
    id: `ip-camera-${key}`,
    key,
    label: t(`ip.cameraTypes.${key}`),
    legacySku: CAMERA_IP_QUOTE_LEGACY_SKUS.camera[key],
  }));
  const ipRecorderRows = (["4", "8", "16"] as const).flatMap((size) => [
    {
      id: `ip-recorder-${size}`,
      label: t("ip.recorderConfiguration", { count: size }),
      field: "recorderProductIds" as const,
      mapKey: `${size}:nvr`,
      legacySku: CAMERA_IP_QUOTE_LEGACY_SKUS.recorder[`${size}:nvr` as keyof typeof CAMERA_IP_QUOTE_LEGACY_SKUS.recorder],
    },
    {
      id: `ip-switch-${size}`,
      label: t("ip.switchConfiguration", { count: size }),
      field: "switchProductIds" as const,
      mapKey: size,
      legacySku: CAMERA_IP_QUOTE_LEGACY_SKUS.switch[size],
    },
  ]);
  const ipStorageRows = CAMERA_IP_QUOTE_STORAGE_SIZES.map((size) => ({
    id: `ip-storage-${size}`,
    label: `${size}TB`,
    mapKey: size,
    legacySku: CAMERA_IP_QUOTE_LEGACY_SKUS.storage[size],
  }));
  const ipAccessoryRows = [
    ["materialProductId", t("ip.accessories.material"), CAMERA_IP_QUOTE_LEGACY_SKUS.material],
    ["installationProductId", t("ip.accessories.installation"), CAMERA_IP_QUOTE_LEGACY_SKUS.installation],
    ["cableProductId", t("ip.accessories.cable"), CAMERA_IP_QUOTE_LEGACY_SKUS.cable],
    ["upsProductId", t("ip.accessories.ups"), CAMERA_IP_QUOTE_LEGACY_SKUS.ups],
    ["rackProductId", t("ip.accessories.rack"), CAMERA_IP_QUOTE_LEGACY_SKUS.rack],
    ["monitorProductId", t("ip.accessories.monitor"), CAMERA_IP_QUOTE_LEGACY_SKUS.monitor],
    ["surgeProductId", t("ip.accessories.surge"), CAMERA_IP_QUOTE_LEGACY_SKUS.surge],
  ] as const;
  const ipCameraColumns: DataTableColumn<(typeof ipCameraRows)[number]>[] = [
    {
      key: "type",
      label: t("ip.cameraType"),
      required: true,
      width: "180px",
      render: (row) => <span className="text-xs font-bold">{row.label}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("ip.product"),
      required: true,
      render: (row) => {
        const id = form.ipQuote.cameraProductIds[row.key] ?? "";
        return (
          <SearchableSelect
            value={id}
            options={ipProductOptions([row.legacySku], id)}
            allowClear={false}
            disabled={!canManage}
            onChange={(value) => setIpProductMap("cameraProductIds", row.key, value)}
            className={searchableTouch}
          />
        );
      },
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("ip.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (row) => {
        const product = ipProduct(form.ipQuote.cameraProductIds[row.key]);
        return product ? formatCurrency(product.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("ip.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (row) => {
        const product = ipProduct(form.ipQuote.cameraProductIds[row.key]);
        return (
          <MoneyInput
            aria-label={t("ip.quotePriceAria", { label: row.label })}
            value={product ? cameraQuotePrice(product.id, product.retailPrice, form) : null}
            disabled={!canManage || !product}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => product && setPriceOverride(product.id, value, product.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const ipRecorderColumns: DataTableColumn<(typeof ipRecorderRows)[number]>[] = [
    {
      key: "configuration",
      label: t("ip.configuration"),
      required: true,
      width: "210px",
      render: (row) => <span className="text-xs font-bold">{row.label}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("ip.product"),
      required: true,
      render: (row) => {
        const id = form.ipQuote[row.field][row.mapKey] ?? "";
        return (
          <SearchableSelect
            value={id}
            options={ipProductOptions([row.legacySku], id)}
            allowClear={false}
            disabled={!canManage}
            onChange={(value) => setIpProductMap(row.field, row.mapKey, value)}
            className={searchableTouch}
          />
        );
      },
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("ip.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (row) => {
        const product = ipProduct(form.ipQuote[row.field][row.mapKey]);
        return product ? formatCurrency(product.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("ip.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (row) => {
        const product = ipProduct(form.ipQuote[row.field][row.mapKey]);
        return (
          <MoneyInput
            aria-label={t("ip.quotePriceAria", { label: row.label })}
            value={product ? cameraQuotePrice(product.id, product.retailPrice, form) : null}
            disabled={!canManage || !product}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => product && setPriceOverride(product.id, value, product.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const ipStorageColumns: DataTableColumn<(typeof ipStorageRows)[number]>[] = [
    {
      key: "capacity",
      label: t("ip.capacity"),
      required: true,
      width: "120px",
      render: (row) => <span className="text-xs font-bold">{row.label}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("ip.product"),
      required: true,
      render: (row) => {
        const id = form.ipQuote.storageProductIds[row.mapKey] ?? "";
        return (
          <SearchableSelect
            value={id}
            options={ipProductOptions([row.legacySku], id)}
            allowClear={false}
            disabled={!canManage}
            onChange={(value) => setIpProductMap("storageProductIds", row.mapKey, value)}
            className={searchableTouch}
          />
        );
      },
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("ip.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (row) => {
        const product = ipProduct(form.ipQuote.storageProductIds[row.mapKey]);
        return product ? formatCurrency(product.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("ip.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (row) => {
        const product = ipProduct(form.ipQuote.storageProductIds[row.mapKey]);
        return (
          <MoneyInput
            aria-label={t("ip.quotePriceAria", { label: row.label })}
            value={product ? cameraQuotePrice(product.id, product.retailPrice, form) : null}
            disabled={!canManage || !product}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => product && setPriceOverride(product.id, value, product.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const ipAccessoryColumns: DataTableColumn<(typeof ipAccessoryRows)[number]>[] = [
    {
      key: "accessory",
      label: t("ip.item"),
      required: true,
      width: "190px",
      render: (row) => <span className="text-xs font-bold">{row[1]}</span>,
      sortable: false,
    },
    {
      key: "product",
      label: t("ip.product"),
      required: true,
      render: (row) => {
        const id = form.ipQuote[row[0]] ?? "";
        return (
          <SearchableSelect
            value={id}
            options={ipProductOptions([row[2]], id)}
            allowClear={false}
            disabled={!canManage}
            onChange={(value) => setIpProduct(row[0], value)}
            className={searchableTouch}
          />
        );
      },
      sortable: false,
    },
    {
      key: "costPrice",
      label: rightHeader(t("ip.costPrice")),
      required: true,
      align: "right",
      width: "120px",
      render: (row) => {
        const product = ipProduct(form.ipQuote[row[0]]);
        return product ? formatCurrency(product.costPrice) : "—";
      },
      sortable: false,
    },
    {
      key: "quotePrice",
      label: rightHeader(t("ip.salePrice")),
      required: true,
      align: "right",
      width: "150px",
      render: (row) => {
        const product = ipProduct(form.ipQuote[row[0]]);
        return (
          <MoneyInput
            aria-label={t("ip.quotePriceAria", { label: row[1] })}
            value={product ? cameraQuotePrice(product.id, product.retailPrice, form) : null}
            disabled={!canManage || !product}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(value) => product && setPriceOverride(product.id, value, product.retailPrice)}
          />
        );
      },
      sortable: false,
    },
  ];
  const renderIpMobileRow = (
    label: string,
    product: CameraQuoteFormOptions["cameras"][number] | undefined,
    selector: React.ReactNode,
    onChange: (value: number | null) => void,
  ) => (
    <div className="grid gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-xs font-bold leading-5">{label}</span>
        <div className="shrink-0 text-right">
          <div className={FL}>{t("ip.costPrice")}</div>
          <div className="mt-0.5 text-xs tabular-nums text-slate-500">{product ? formatCurrency(product.costPrice) : "—"}</div>
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className={FL}>{t("ip.product")}</span>
        {selector}
      </div>
      <div className="grid gap-1.5">
        <span className={FL}>{t("ip.salePrice")}</span>
        <MoneyInput
          aria-label={t("ip.mobileSalePriceAria", { label })}
          value={product ? cameraQuotePrice(product.id, product.retailPrice, form) : null}
          disabled={!canManage || !product}
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={onChange}
        />
      </div>
    </div>
  );

  return (
    <>
      <Card
        title={t("defaultsTitle")}
        vi={t("defaultsSubtitle")}
      >
        <div className="p-4.5 flex flex-col gap-4">
          <div className="rounded-[10px] border border-primary-200 bg-primary-50 px-3.5 py-3 text-[11px] leading-5 text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
            {t("notice")}
          </div>

          <Card title={t("wifi.title")} vi={t("wifi.subtitle")}>
            <div className="p-3.5">
              <input
                className={FI}
                value={query}
                disabled={!canManage}
                onChange={(event) => setQuery(event.target.value)}
                onClick={selectAllInputOnClick}
                placeholder={t("wifi.searchPlaceholder")}
              />
              <div className="mt-3">
                <DataTableShell
                  tableId="settings.camera-quote.cameras"
                  rows={visibleCameras}
                  columns={cameraColumns}
                  getRowId={(product) => product.id}
                  minWidth="760px"
                  maxHeight="384px"
                  fillHeight={false}
                  showColumnMenu={false}
                  embedded
                  empty={<div className="p-6 text-center text-xs text-slate-400">{t("wifi.empty")}</div>}
                  renderMobileRow={({ row }) => (
                    <div className="grid gap-3 border-b border-border-soft p-3 last:border-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold leading-5">{row.name}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">{row.sku}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={FL}>{t("wifi.costPrice")}</div>
                          <div className="mt-0.5 text-xs tabular-nums text-slate-500">{formatCurrency(row.costPrice)}</div>
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("wifi.salePrice")}</span>
                        <MoneyInput
                          aria-label={t("wifi.quotePriceAria", { product: row.name })}
                          value={cameraQuotePrice(row.id, row.retailPrice, form)}
                          disabled={!canManage}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onChange={(value) => setPriceOverride(row.id, value, row.retailPrice)}
                        />
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          </Card>

          <Card title={t("memory.title")} vi={t("memory.subtitle")}>
            <div className="p-3.5">
              <DataTableShell
                tableId="settings.camera-quote.memory-cards"
                rows={memoryRows}
                columns={memoryColumns}
                getRowId={(row) => row.id}
                minWidth="820px"
                maxHeight="360px"
                fillHeight={false}
                showColumnMenu={false}
                embedded
                empty={<div className="p-6 text-center text-xs text-slate-400">{t("memory.empty")}</div>}
                renderMobileRow={({ row }) => {
                  const selectedId = form.memoryCardSelections?.[row.capacity] ?? row.products.find((product) => selectedCardIds.has(product.id))?.id ?? "";
                  const selected = selectedId ? productById.get(selectedId) : undefined;
                  return (
                    <div className="grid gap-3 border-b border-border-soft p-3 last:border-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className={FL}>{t("memory.capacity")}</div>
                          <div className="mt-0.5 text-xs font-extrabold text-slate-700">{row.capacity}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={FL}>{t("memory.costPrice")}</div>
                          <div className="mt-0.5 text-xs tabular-nums text-slate-500">{selected ? formatCurrency(selected.costPrice) : "—"}</div>
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("memory.selected")}</span>
                        <SearchableSelect
                          value={selectedId}
                          options={row.products.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
                          allowClear={false}
                          disabled={!canManage}
                          onChange={(value) => setMemoryCardSelection(row.capacity, value)}
                          className={searchableTouch}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("memory.salePrice")}</span>
                        <MoneyInput
                          aria-label={t("memory.quotePriceAria", { capacity: row.capacity })}
                          value={selected ? cameraQuotePrice(selected.id, selected.retailPrice, form) : null}
                          disabled={!canManage || !selected}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onChange={(value) => selected && setPriceOverride(selected.id, value, selected.retailPrice)}
                        />
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </Card>

          <Card title={t("installation.title")} vi={t("installation.subtitle")}>
            <div className="p-3.5">
              <DataTableShell
                tableId="settings.camera-quote.installation"
                rows={profileRows}
                columns={installationColumns}
                getRowId={(row) => row.id}
                minWidth="640px"
                maxHeight="360px"
                fillHeight={false}
                showColumnMenu={false}
                embedded
                renderFollowingRows={(profile, visibleColumns) => {
                  const installation = form[profile.installationField] ? productById.get(form[profile.installationField]!) : undefined;
                  return (
                    <tr className="border-t border-border-soft bg-canvas/35">
                      {visibleColumns.map((column) => {
                        const cellClassName = typeof column.cellClassName === "function" ? column.cellClassName(profile) : column.cellClassName;
                        const cellClass = cn(
                          "px-3 py-3 align-middle",
                          column.align === "right" && "text-right tabular-nums",
                          cellClassName,
                        );
                        if (column.key === "profile") return <td key={column.key} className={cellClass} />;
                        if (column.key === "itemType") return <td key={column.key} className={cellClass}><span className="text-xs font-semibold">{t("installation.labor")}</span></td>;
                        if (column.key === "product") {
                          return (
                            <td key={column.key} className={cellClass}>
                              <SearchableSelect
                                value={form[profile.installationField] ?? ""}
                                options={options.installations.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
                                allowClear={false}
                                disabled={!canManage}
                                onChange={(value) => setProduct(profile.installationField, value)}
                                className={searchableTouch}
                              />
                            </td>
                          );
                        }
                        if (column.key === "costPrice") return <td key={column.key} className={cellClass}>{installation ? formatCurrency(installation.costPrice) : "—"}</td>;
                        return (
                          <td key={column.key} className={cellClass}>
                            <MoneyInput
                              aria-label={t("installation.laborSaleAria", { profile: profile.label })}
                              value={installation ? cameraQuotePrice(installation.id, installation.retailPrice, form) : null}
                              disabled={!canManage || !installation}
                              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                              onChange={(value) => installation && setPriceOverride(installation.id, value, installation.retailPrice)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                }}
                renderMobileRow={({ row }) => {
                  const material = form[row.materialField] ? productById.get(form[row.materialField]!) : undefined;
                  const installation = form[row.installationField] ? productById.get(form[row.installationField]!) : undefined;
                  return (
                    <div className="grid gap-3 border-b border-border-soft p-3 last:border-0">
                      <div className="text-xs font-bold leading-5">{row.label}</div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("installation.material")}</span>
                        <SearchableSelect
                          value={form[row.materialField] ?? ""}
                          options={options.materials.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
                          allowClear={false}
                          disabled={!canManage}
                          onChange={(value) => setProduct(row.materialField, value)}
                          className={searchableTouch}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
                        <span className={FL}>{t("installation.materialCostPrice")}</span>
                        <span>{material ? formatCurrency(material.costPrice) : "—"}</span>
                      </div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("installation.materialSalePrice")}</span>
                        <MoneyInput
                          aria-label={t("installation.materialSaleAria", { profile: row.label })}
                          value={material ? cameraQuotePrice(material.id, material.retailPrice, form) : null}
                          disabled={!canManage || !material}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onChange={(value) => material && setPriceOverride(material.id, value, material.retailPrice)}
                        />
                      </div>
                      <div className="grid gap-1.5 border-t border-border-soft pt-3">
                        <span className={FL}>{t("installation.labor")}</span>
                        <SearchableSelect
                          value={form[row.installationField] ?? ""}
                          options={options.installations.map((product) => ({ value: product.id, label: product.name, hint: product.sku }))}
                          allowClear={false}
                          disabled={!canManage}
                          onChange={(value) => setProduct(row.installationField, value)}
                          className={searchableTouch}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
                        <span className={FL}>{t("installation.laborCostPrice")}</span>
                        <span>{installation ? formatCurrency(installation.costPrice) : "—"}</span>
                      </div>
                      <div className="grid gap-1.5">
                        <span className={FL}>{t("installation.laborSalePrice")}</span>
                        <MoneyInput
                          aria-label={t("installation.laborSaleAria", { profile: row.label })}
                          value={installation ? cameraQuotePrice(installation.id, installation.retailPrice, form) : null}
                          disabled={!canManage || !installation}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-right text-xs tabular-nums outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onChange={(value) => installation && setPriceOverride(installation.id, value, installation.retailPrice)}
                        />
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </Card>

          <Card title={t("ip.title")} vi={t("ip.subtitle")}>
            <div className="space-y-5 p-3.5">
              <section>
                <div className="mb-2">
                  <div className="text-xs font-bold">{t("ip.cameraTitle")}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{t("ip.cameraSubtitle")}</div>
                </div>
                <DataTableShell
                  tableId="settings.camera-quote.ip-cameras"
                  rows={ipCameraRows}
                  columns={ipCameraColumns}
                  getRowId={(row) => row.id}
                  minWidth="820px"
                  maxHeight="360px"
                  fillHeight={false}
                  showColumnMenu={false}
                  embedded
                  renderMobileRow={({ row }) => {
                    const id = form.ipQuote.cameraProductIds[row.key] ?? "";
                    const product = ipProduct(id);
                    return renderIpMobileRow(
                      row.label,
                      product,
                      <SearchableSelect
                        value={id}
                        options={ipProductOptions([row.legacySku], id)}
                        allowClear={false}
                        disabled={!canManage}
                        onChange={(value) => setIpProductMap("cameraProductIds", row.key, value)}
                        className={searchableTouch}
                      />,
                      (value) => product && setPriceOverride(product.id, value, product.retailPrice),
                    );
                  }}
                />
              </section>

              <section>
                <div className="mb-2">
                  <div className="text-xs font-bold">{t("ip.recorderTitle")}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{t("ip.recorderSubtitle")}</div>
                </div>
                <DataTableShell
                  tableId="settings.camera-quote.ip-recorders"
                  rows={ipRecorderRows}
                  columns={ipRecorderColumns}
                  getRowId={(row) => row.id}
                  minWidth="850px"
                  maxHeight="400px"
                  fillHeight={false}
                  showColumnMenu={false}
                  embedded
                  renderMobileRow={({ row }) => {
                    const id = form.ipQuote[row.field][row.mapKey] ?? "";
                    const product = ipProduct(id);
                    return renderIpMobileRow(
                      row.label,
                      product,
                      <SearchableSelect
                        value={id}
                        options={ipProductOptions([row.legacySku], id)}
                        allowClear={false}
                        disabled={!canManage}
                        onChange={(value) => setIpProductMap(row.field, row.mapKey, value)}
                        className={searchableTouch}
                      />,
                      (value) => product && setPriceOverride(product.id, value, product.retailPrice),
                    );
                  }}
                />
              </section>

              <section>
                <div className="mb-2">
                  <div className="text-xs font-bold">{t("ip.storageTitle")}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{t("ip.storageSubtitle")}</div>
                </div>
                <DataTableShell
                  tableId="settings.camera-quote.ip-storage"
                  rows={ipStorageRows}
                  columns={ipStorageColumns}
                  getRowId={(row) => row.id}
                  minWidth="820px"
                  maxHeight="360px"
                  fillHeight={false}
                  showColumnMenu={false}
                  embedded
                  renderMobileRow={({ row }) => {
                    const id = form.ipQuote.storageProductIds[row.mapKey] ?? "";
                    const product = ipProduct(id);
                    return renderIpMobileRow(
                      row.label,
                      product,
                      <SearchableSelect
                        value={id}
                        options={ipProductOptions([row.legacySku], id)}
                        allowClear={false}
                        disabled={!canManage}
                        onChange={(value) => setIpProductMap("storageProductIds", row.mapKey, value)}
                        className={searchableTouch}
                      />,
                      (value) => product && setPriceOverride(product.id, value, product.retailPrice),
                    );
                  }}
                />
              </section>

              <section>
                <div className="mb-2">
                  <div className="text-xs font-bold">{t("ip.accessoriesTitle")}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{t("ip.accessoriesSubtitle")}</div>
                </div>
                <DataTableShell
                  tableId="settings.camera-quote.ip-accessories"
                  rows={[...ipAccessoryRows]}
                  columns={ipAccessoryColumns}
                  getRowId={(row) => row[0]}
                  minWidth="850px"
                  maxHeight="440px"
                  fillHeight={false}
                  showColumnMenu={false}
                  embedded
                  renderMobileRow={({ row }) => {
                    const id = form.ipQuote[row[0]] ?? "";
                    const product = ipProduct(id);
                    return renderIpMobileRow(
                      row[1],
                      product,
                      <SearchableSelect
                        value={id}
                        options={ipProductOptions([row[2]], id)}
                        allowClear={false}
                        disabled={!canManage}
                        onChange={(value) => setIpProduct(row[0], value)}
                        className={searchableTouch}
                      />,
                      (value) => product && setPriceOverride(product.id, value, product.retailPrice),
                    );
                  }}
                />
              </section>
            </div>
          </Card>

          <SaveBar
            L={false}
            labels={{
              permission: t("saveBar.permission"),
              unsaved: t("saveBar.unsaved"),
              saved: t("saveBar.saved"),
              save: t("saveBar.save"),
            }}
            dirty={dirty}
            saved={saved}
            pending={pending}
            canManage={canManage}
            error={error}
            onSave={save}
          />
        </div>
      </Card>
    </>
  );
}

function StaffSection({ L, staff, canManage }: { L: boolean; staff: StaffRow[]; canManage: boolean }) {
  const [tab, setTab] = useState<"list" | "perms">("list");
  const roles = ["owner", "manager", "cashier", "stock", "accountant"];
  return (
    <>
      <SegmentedTabs
        className="mb-3.5"
        items={[
          { id: "list", label: settingsTextByFlag(L, "legacy.fbeb731bf942") },
          { id: "perms", label: settingsTextByFlag(L, "legacy.39f66c66bb76") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "list" && (
        <Card title={settingsTextByFlag(L, "legacy.495fdd9788f8")} vi={settingsTextByFlag(L, "legacy.deca5f03b901")}>
          {staff.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{settingsTextByFlag(L, "legacy.3d5570d660db")}</p>
          ) : (
            <div className="overflow-visible md:overflow-x-auto" data-mobile-audit="settings-staff">
              <table className="block w-full text-sm md:table">
                <thead className="hidden md:table-header-group"><tr className="bg-canvas text-left text-[9px] uppercase tracking-wide text-slate-400 border-b border-border">
                  <th className="px-3 py-2 font-bold">{settingsTextByFlag(L, "legacy.28433b857242")}</th>
                  <th className="px-3 py-2 font-bold">{settingsTextByFlag(L, "legacy.500066278f54")}</th>
                  <th className="px-3 py-2 font-bold">{settingsTextByFlag(L, "legacy.5745605d2af1")}</th>
                  <th className="px-3 py-2 font-bold">{settingsTextByFlag(L, "legacy.81a5b063f527")}</th>
                </tr></thead>
                <tbody className="block md:table-row-group">{staff.map((s, i) => <StaffRowItem key={s.id} s={s} i={i} L={L} canManage={canManage} />)}</tbody>
              </table>
            </div>
          )}
          {canManage && <div className="px-4 py-2.5 border-t border-border text-[10px] text-slate-400 italic">{settingsTextByFlag(L, "legacy.a29acbc36055")}</div>}
        </Card>
      )}
      {tab === "perms" && (
        <Card title={settingsTextByFlag(L, "legacy.0c3cf56f43fe")} vi={settingsTextByFlag(L, "legacy.d3462055821b")}>
          <div className="divide-y divide-border-soft md:hidden" data-mobile-audit="settings-permissions">
            {PERMS.map((p, i) => (
              <article key={i} className="p-3">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{settingsTextByFlag(L, `ui.permissions.${p.key}`)}</h4>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  {roles.map((r) => (
                    <div key={r} className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-2 py-2">
                      <dt className="text-slate-500">{settingsTextByFlag(L, `ui.roles.${ROLE_LABELS[r] ?? r}`)}</dt>
                      <dd aria-label={p.roles[r] ? (settingsTextByFlag(L, "legacy.11225dbe9c65")) : (settingsTextByFlag(L, "legacy.487230a9c0fa"))}>
                        {p.roles[r] ? <Check className="h-4 w-4 text-ok" /> : <span className="text-slate-300 dark:text-slate-700">✕</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-canvas border-b border-border text-[9px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2 text-left font-bold min-w-45">{settingsTextByFlag(L, "legacy.51927998f6ae")}</th>
                {roles.map((r) => <th key={r} className="px-2 py-2 font-bold text-center">{settingsTextByFlag(L, `ui.roles.${ROLE_LABELS[r] ?? r}`)}</th>)}
              </tr></thead>
              <tbody>{PERMS.map((p, i) => (
                <tr key={i} className="border-b border-border-soft last:border-0">
                  <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">{settingsTextByFlag(L, `ui.permissions.${p.key}`)}</td>
                  {roles.map((r) => <td key={r} className="px-2 py-2 text-center">{p.roles[r] ? <Check className="w-3.5 h-3.5 text-ok inline" /> : <span className="text-slate-300 dark:text-slate-700">✕</span>}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border-t border-in/20 text-[10px] text-in">
            {settingsTextByFlag(L, "legacy.cdfc710b5ed9")}
          </div>
        </Card>
      )}
    </>
  );
}

function HardwareSection({ L, prefs, canManage }: { L: boolean; prefs: StorePrefs["hardware"]; canManage: boolean }) {
  const [form, setForm] = useState(prefs);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((p) => ({ ...p, [k]: v })); setDirty(true); setSaved(false); };
  function save() { start(async () => { const r = await updateStorePrefs({ hardware: form }); if (r.ok) { setDirty(false); setSaved(true); } }); }

  const dot = { connected: "bg-ok", disconnected: "bg-er", unconfigured: "bg-slate-400" } as const;
  const lbl = { connected: [settingsTextByFlag(L, "legacy.a213c40eb1c6"), "text-ok"], disconnected: [settingsTextByFlag(L, "legacy.8ed42f8a481b"), "text-er"], unconfigured: [settingsTextByFlag(L, "legacy.38655a2b9fca"), "text-slate-400"] } as const;
  return (
    <>
      <Card title={settingsTextByFlag(L, "legacy.e2c29e998b87")} vi={settingsTextByFlag(L, "legacy.95354db6d787")}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-col gap-1 max-w-50">
            <span className={FL}>{settingsTextByFlag(L, "legacy.a2fc979f0e38")}</span>
            <SearchableSelect options={PAPER_SIZES.map((s) => ({ value: s, label: s }))} value={form.paperSize} onChange={(v) => set("paperSize", v as typeof form.paperSize)} allowClear={false} disabled={!canManage} className={searchableTouch} />
          </div>
          <CtrlRow title={settingsTextByFlag(L, "legacy.1aa189ecc1cc")} checked={form.autoPrint} onChange={canManage ? (v) => set("autoPrint", v) : undefined} />
          <CtrlRow title={settingsTextByFlag(L, "legacy.47e373cda842")} checked={form.openDrawer} onChange={canManage ? (v) => set("openDrawer", v) : undefined} />
          <div className="flex items-center gap-2"><Link href="/settings/print" className={btnS}><Printer className="w-3 h-3" />{settingsTextByFlag(L, "legacy.06d544b44c79")}</Link></div>
          <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
        </div>
      </Card>
      <Card title={settingsTextByFlag(L, "legacy.b440eb4f8ce5")} vi={settingsTextByFlag(L, "legacy.bc838bfce768")}>
        <div className="p-4 flex flex-col gap-2">
          {DEVICES.map((d, i) => (
            <div key={i} className={cn(ROW, "opacity-70")}>
              <span className="w-9 h-9 rounded-[10px] bg-surface-2 grid place-items-center text-lg shrink-0">{d.ico}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate">{d.name}</div>
                <div className="text-[10px] text-slate-500">{settingsTextByFlag(L, `ui.devices.${d.labelKey}`)} · {d.detail}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn("w-2 h-2 rounded-full", dot[d.status as keyof typeof dot])} />
                <span className={cn("text-[10px] font-bold", lbl[d.status as keyof typeof lbl][1])}>{lbl[d.status as keyof typeof lbl][0]}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

const EMPTY_BANK_ACCOUNT: PaymentBankAccountInput = {
  provider: "sepay",
  bankCode: "",
  gateway: "",
  accountNumber: "",
  subAccount: "",
  accountName: "",
  isDefault: false,
  enabled: true,
  webhookEnabled: true,
  webhookSecret: "",
  apiKey: "",
  note: "",
};

function PaymentsSection({
  L,
  prefs,
  canManage,
  bankAccounts,
  accountsLoading,
  accountsError,
}: {
  L: boolean;
  prefs: StorePrefs["payments"];
  canManage: boolean;
  bankAccounts: PaymentBankAccountRow[];
  accountsLoading: boolean;
  accountsError?: string;
}) {
  const [pm, setPm] = useState(prefs);
  const [tab, setTab] = useState<"methods" | "accounts" | "notifications">("methods");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const toggle = (id: keyof typeof pm) => { if (!canManage) return; setPm((p) => ({ ...p, [id]: !p[id] })); setDirty(true); setSaved(false); };
  function save() { start(async () => { const r = await updateStorePrefs({ payments: pm }); if (r.ok) { setDirty(false); setSaved(true); } }); }
  const tabs = [
    { id: "methods", label: settingsTextByFlag(L, "legacy.75b7ecc9fa25") },
    { id: "accounts", label: settingsTextByFlag(L, "legacy.6cf92dd12923") },
    { id: "notifications", label: settingsTextByFlag(L, "legacy.9f8d503d1f1c") },
  ] as const;
  return (
    <>
      <SegmentedTabs className="mb-4" items={tabs} value={tab} onChange={setTab} />
      {tab === "methods" && (
        <Card title={settingsTextByFlag(L, "legacy.492a4cefe2c7")} vi={settingsTextByFlag(L, "legacy.abe75d28763f")}>
          <div className="p-4 flex flex-col gap-2">
            {PAYMENTS.map((p) => {
              const id = p.id as keyof typeof pm;
              return (
                <div key={p.id} className={ROW}>
                  <span className="w-9 h-9 rounded-[10px] grid place-items-center text-lg shrink-0" style={{ background: p.color + "22", border: `1px solid ${p.color}33` }}>{p.ico}</span>
                  <div className="flex-1 min-w-0"><div className="text-xs font-bold">{settingsTextByFlag(L, `ui.payments.${p.labelKey}`)}</div><div className="text-[10px] text-slate-500">{p.note}</div></div>
                  <TouchTargetToggle checked={pm[id]} onChange={() => toggle(id)} aria-label={settingsTextByFlag(L, `ui.payments.${p.labelKey}`)} />
                </div>
              );
            })}
          </div>
          <div className="px-4.5 pb-4"><SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} /></div>
        </Card>
      )}
      {tab === "accounts" && (
        accountsLoading || accountsError
          ? <LazySectionState L={L} loading={accountsLoading} error={accountsError} />
          : <SePayAccountsSection L={L} accounts={bankAccounts} canManage={canManage} />
      )}
      {tab === "notifications" && <SePayNotificationsSection L={L} />}
    </>
  );
}

function SePayNotificationsSection({ L }: { L: boolean }) {
  const t = useTranslations("settings.payments.sepay");
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => typeof window !== "undefined" ? window.location.origin : "");
  const webhookOrigin = origin === "https://lumapos.shop" ? "https://www.lumapos.shop" : origin;
  const webhookUrl = webhookOrigin ? `${webhookOrigin}/api/payments/sepay/webhook` : "/api/payments/sepay/webhook";
  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card title={t("notificationTitle")} vi={settingsTextByFlag(L, "legacy.ab21a20f0c4d")}>
      <div className="p-4 flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-canvas p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold">{t("setupTitle")}</div>
            </div>
            <a href="https://my.sepay.vn" target="_blank" rel="noreferrer" className={cn(btnS, "shrink-0 rounded-lg px-3 whitespace-nowrap")}>
              <ExternalLink className="w-3.5 h-3.5" />{t("openSepay")}
            </a>
          </div>
          <div className="mt-2 max-w-5xl text-[11px] leading-relaxed text-slate-500">{t("notificationHelp")}</div>
          <div className="mt-3 grid gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <div className="flex gap-2"><span className="font-bold text-primary-600">1.</span><span>{t("notifyStep1")}</span></div>
            <div className="flex gap-2"><span className="font-bold text-primary-600">2.</span><span>{t("notifyStep2")}</span></div>
            <div className="flex gap-2"><span className="font-bold text-primary-600">3.</span><span>{t("notifyStep3")}</span></div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
              {webhookUrl}
            </div>
            <button type="button" onClick={copyWebhookUrl} className={btnS}>
              <Copy className="w-3.5 h-3.5" />{copied ? t("copied") : t("copyUrl")}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SePayAccountsSection({ L, accounts, canManage }: { L: boolean; accounts: PaymentBankAccountRow[]; canManage: boolean }) {
  const dialog = useConfirmDialog();
  const t = useTranslations("settings.payments.sepay");
  const [form, setForm] = useState<PaymentBankAccountInput>(EMPTY_BANK_ACCOUNT);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const isEditing = Boolean(form.id);
  const set = <K extends keyof PaymentBankAccountInput>(key: K, value: PaymentBankAccountInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage("");
  };
  const reset = () => {
    setForm(EMPTY_BANK_ACCOUNT);
    setMessage("");
  };
  const openNew = () => {
    reset();
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    reset();
  };
  const edit = (account: PaymentBankAccountRow) => {
    setForm({
      id: account.id,
      provider: "sepay",
      bankCode: account.bankCode,
      gateway: account.gateway ?? "",
      accountNumber: account.accountNumber,
      subAccount: account.subAccount ?? "",
      accountName: account.accountName,
      isDefault: account.isDefault,
      enabled: account.enabled,
      webhookEnabled: account.webhookEnabled,
      webhookSecret: "",
      apiKey: "",
      note: account.note ?? "",
    });
    setMessage("");
    setFormOpen(true);
  };
  const saveAccount = () => {
    start(async () => {
      const res = await savePaymentBankAccount(form);
      if (res.ok) {
        setMessage(t("saved"));
        setFormOpen(false);
        setForm(EMPTY_BANK_ACCOUNT);
      } else {
        setMessage(t("saveError"));
      }
    });
  };
  const toggleEnabled = (id: string, enabled: boolean) => {
    start(async () => {
      const res = await setPaymentBankAccountEnabled(id, enabled);
      setMessage(res.ok ? t("saved") : t("saveError"));
    });
  };
  const makeDefault = (id: string) => {
    start(async () => {
      const res = await setDefaultPaymentBankAccount(id);
      setMessage(res.ok ? t("saved") : t("saveError"));
    });
  };
  const remove = async (account: PaymentBankAccountRow) => {
    const ok = await dialog.confirm({ description: t("deleteConfirm", { account: account.accountNumber }), variant: "destructive" });
    if (!ok) return;
    start(async () => {
      const res = await deletePaymentBankAccount(account.id);
      setMessage(res.ok ? t("deleted") : t("deleteError"));
      if (form.id === account.id) reset();
    });
  };
  const selectBank = (bank: VietQrBank) => {
    setForm((prev) => ({ ...prev, bankCode: bank.code, gateway: bank.shortName }));
    setMessage("");
  };
  return (
    <Card title={t("title")} vi={settingsTextByFlag(L, "legacy.9d784c22316b")}>
      <div className="p-4 flex flex-col gap-4">
        <div className="rounded-xl border border-in/20 bg-in-soft px-3.5 py-3 text-[11px] leading-relaxed text-in">{t("qrOnlyHelp")}</div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold">{t("accounts")}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t("help")}</div>
          </div>
          {canManage && (
            <button type="button" onClick={openNew} className={btnS}>
              <Plus className="w-3.5 h-3.5" />{t("newAccount")}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {accounts.length === 0 && (
            <div className="px-3.5 py-3 rounded-[10px] bg-canvas border border-border text-[12px] text-slate-500">{t("empty")}</div>
          )}
          {accounts.map((account) => (
            <div key={account.id} className={cn(ROW, "flex-col items-stretch sm:flex-row sm:items-start")}>
              <div className="w-9 h-9 rounded-[10px] bg-primary-50 dark:bg-primary-950/40 grid place-items-center text-primary-700 dark:text-primary-300 shrink-0">
                <BankLogo bank={VIETQR_BANKS.find((bank) => bank.code === account.bankCode)} fallback={account.bankCode} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-bold truncate">{account.accountName}</div>
                  {account.isDefault && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">{t("default")}</span>}
                  {!account.enabled && <span className="rounded-full px-2 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800">{t("disabled")}</span>}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                  {account.bankCode} · {account.accountNumber}{account.subAccount ? ` · ${account.subAccount}` : ""}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-semibold text-slate-500">{account.webhookEnabled ? t("webhookOn") : t("webhookOff")}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[9px] font-semibold text-slate-500">{t("qrReady")}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto">
                  <button type="button" onClick={() => edit(account)} className={btnS} aria-label={t("edit")}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={account.isDefault || pending}
                    onClick={() => makeDefault(account.id)}
                    className={cn(
                      btnS,
                      account.isDefault && "border-primary-200 bg-primary-50 text-primary-700 disabled:opacity-100 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-300",
                    )}
                    aria-label={t("setDefault")}
                    aria-pressed={account.isDefault}
                  >
                    <Star className={cn("w-3.5 h-3.5", account.isDefault && "fill-current")} />
                  </button>
                  <button type="button" disabled={pending} onClick={() => toggleEnabled(account.id, !account.enabled)} className={btnS} aria-label={account.enabled ? t("disable") : t("enable")}>
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={pending} onClick={() => remove(account)} className={cn(btnS, "text-er hover:bg-er-soft")} aria-label={t("delete")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {message && <div className="text-[11px] font-medium text-slate-500">{message}</div>}
      </div>

      {canManage && formOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) closeForm();
          }}
        >
          <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-e2 sm:rounded-card">
            <header className="flex items-start justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="text-sm font-bold">{isEditing ? t("editAccount") : t("addAccount")}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{settingsTextByFlag(L, "legacy.147751e48352")}</div>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={pending}
                className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 disabled:opacity-50 lg:min-h-0 lg:min-w-0"
                aria-label={t("cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1"><span className={FL}>{t("bankCode")}</span><BankSelect value={form.bankCode} onChange={selectBank} placeholder={t("bankPlaceholder")} /></div>
                <div className="flex flex-col gap-1"><span className={FL}>{t("gateway")}</span><input className={FI} value={form.gateway ?? ""} onChange={(e) => set("gateway", e.target.value)} placeholder="Vietcombank" /></div>
                <div className="flex flex-col gap-1"><span className={FL}>{t("accountNumber")}</span><input className={cn(FI, "font-mono")} value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} /></div>
                <div className="flex flex-col gap-1"><span className={FL}>{t("subAccount")}</span><input className={cn(FI, "font-mono")} value={form.subAccount ?? ""} onChange={(e) => set("subAccount", e.target.value)} placeholder={t("optional")} /></div>
                <div className="flex flex-col gap-1"><span className={FL}>{t("accountName")}</span><input className={FI} value={form.accountName} onChange={(e) => set("accountName", e.target.value)} /></div>
                <div className="flex flex-col gap-1"><span className={FL}>{t("note")}</span><input className={FI} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder={t("optional")} /></div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <CtrlRow title={t("enabled")} desc={t("enabledHint")} checked={Boolean(form.enabled)} onChange={(v) => set("enabled", v)} />
                <CtrlRow title={t("webhookEnabled")} desc={t("webhookHint")} checked={Boolean(form.webhookEnabled)} onChange={(v) => set("webhookEnabled", v)} />
                <CtrlRow title={t("makeDefault")} desc={t("defaultHint")} checked={Boolean(form.isDefault)} onChange={(v) => set("isDefault", v)} />
              </div>
              {message && <div className="mt-3 text-[11px] font-medium text-slate-500">{message}</div>}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-border-soft bg-canvas px-4 py-3 sm:px-5">
              <button type="button" onClick={closeForm} disabled={pending} className={btnS}>{t("cancel")}</button>
              <button type="button" disabled={pending || !form.bankCode || !form.accountNumber || !form.accountName} onClick={saveAccount} className={cn(btnF, "disabled:opacity-50")}>
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{t("save")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </Card>
  );
}

function BankLogo({ bank, fallback }: { bank?: VietQrBank; fallback: string }) {
  return bank ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={bank.logo} alt={bank.shortName} className="h-6 w-6 object-contain" />
  ) : (
    <span className="text-[10px] font-black">{fallback.slice(0, 3).toUpperCase() || <KeyRound className="w-4 h-4" />}</span>
  );
}

function BankSelect({ value, onChange, placeholder }: { value: string; onChange: (bank: VietQrBank) => void; placeholder: string }) {
  const t = useTranslations("settings.payments.sepay");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = VIETQR_BANKS.find((bank) => bank.code === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const query = normalizeSearch(q);
    if (!query) return VIETQR_BANKS;
    return VIETQR_BANKS.filter((bank) =>
      normalizeSearch(`${bank.code} ${bank.bin} ${bank.shortName} ${bank.name} ${bank.aliases.join(" ")}`).includes(query)
    );
  }, [q]);

  function pick(bank: VietQrBank) {
    onChange(bank);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={ref} className={cn("relative", open && "z-20")}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(FI, "h-[42px] flex items-center gap-2 text-left")}
      >
        {selected ? (
          <>
            <span className="w-7 h-7 rounded-lg border border-border bg-white grid place-items-center shrink-0"><BankLogo bank={selected} fallback={selected.code} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{selected.shortName}</span>
              <span className="block truncate text-[10px] text-slate-500">{selected.code} · BIN {selected.bin}</span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-slate-400">{placeholder}</span>
        )}
        <ChevronDown className="ml-auto w-4 h-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-[30] mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
          <div className="border-b border-border-soft">
            <input
              autoFocus
              className="min-h-11 w-full bg-transparent px-3 py-2.5 text-sm outline-none"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onClick={selectAllInputOnClick}
              placeholder={t("bankSearch")}
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">{t("bankNoResults")}</div>
            ) : filtered.map((bank) => (
              <button
                key={bank.code}
                type="button"
                onClick={() => pick(bank)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2",
                  bank.code === value && "bg-primary-50 dark:bg-primary-950/40"
                )}
              >
                <span className="w-9 h-9 rounded-lg border border-border bg-white grid place-items-center shrink-0"><BankLogo bank={bank} fallback={bank.code} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{bank.shortName}</span>
                  <span className="block truncate text-[10px] text-slate-500">{bank.name}</span>
                  <span className="block truncate text-[10px] font-mono text-slate-400">{bank.code} · {bank.bin}</span>
                </span>
                {bank.code === value && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PrintSection({ L }: { L: boolean }) {
  const items = [
    {
      href: "/settings/print",
      title: settingsTextByFlag(L, "legacy.2d209a8a0bcb"),
      desc: settingsTextByFlag(L, "legacy.e40ff82a67ce"),
      meta: "A4 / A5 / K80",
      primary: true,
    },
    {
      href: Routes.LabelSettings,
      title: settingsTextByFlag(L, "legacy.c5754b82e407"),
      desc: settingsTextByFlag(L, "legacy.96601028158a"),
      meta: "40x30 / 50x30 / 35x22",
      primary: false,
    },
  ];
  return (
    <Card title={settingsTextByFlag(L, "legacy.59d3763dab7e")} vi={settingsTextByFlag(L, "legacy.71ca4511628b")}>
      <div className="p-4.5">
        <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
          {settingsTextByFlag(L, "legacy.27464a4f5215")}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group block rounded-[10px] border p-4 transition hover:-translate-y-0.5 hover:shadow-e1 min-h-11 min-w-11",
                item.primary
                  ? "border-primary-200 bg-primary-50/70 text-primary-900 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-100"
                  : "border-border bg-canvas text-slate-900 hover:bg-surface-2 dark:text-slate-100",
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", item.primary ? "bg-primary-600 text-white" : "bg-surface border border-border text-slate-600 dark:text-slate-300")}>
                  <Printer className="h-4 w-4" />
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {item.meta}
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </span>
              </div>
              <div className="text-sm font-extrabold">{item.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

function TaxSection({ L, prefs, canManage }: { L: boolean; prefs: StorePrefs["tax"]; canManage: boolean }) {
  const [form, setForm] = useState(prefs);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); setError(""); };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((p) => ({ ...p, [k]: v })); mark(); };
  const setActivity = (index: number, patch: Partial<(typeof form.businessActivities)[number]>) => {
    setForm((current) => ({
      ...current,
      businessActivities: current.businessActivities.map((activity, activityIndex) =>
        activityIndex === index ? { ...activity, ...patch } : activity),
    }));
    mark();
  };
  function addActivity() {
    set("businessActivities", [...form.businessActivities, {
      id: `activity-${Date.now()}`,
      name: "",
      vatRate: 0,
      pitRate: 0,
      enabled: true,
    }]);
  }
  function removeActivity(index: number) {
    const removed = form.businessActivities[index];
    setForm((current) => ({
      ...current,
      businessActivities: current.businessActivities.filter((_, activityIndex) => activityIndex !== index),
      defaultDirectTaxActivityId: removed?.id === current.defaultDirectTaxActivityId ? "" : current.defaultDirectTaxActivityId,
    }));
    mark();
  }
  function save() {
    start(async () => {
      const r = await updateStorePrefs({ tax: form });
      if (r.ok) {
        setDirty(false);
        setSaved(true);
        setError("");
      } else {
        setError(settingsTextByFlag(L, "legacy.193dd7944aa5"));
      }
    });
  }
  const pctColor = (r: number) => r === 0 ? "text-slate-400" : r === 5 ? "text-ok" : r === 8 ? "text-warn" : "text-er";
  const taxpayerTypeOptions = TAXPAYER_TYPES.map((value) => ({
    value,
    label: settingsTextByFlag(L, `ui.tax.taxpayerType.${value}`),
  }));
  const calculationMethodOptions = TAX_CALCULATION_METHODS.map((value) => ({
    value,
    label: settingsTextByFlag(L, `ui.tax.calculationMethod.${value}`),
  }));
  const filingFrequencyOptions = TAX_FILING_FREQUENCIES.map((value) => ({
    value,
    label: settingsTextByFlag(L, `ui.tax.filingFrequency.${value}`),
  }));
  const vatTreatmentOptions = VAT_TREATMENTS.map((value) => ({
    value,
    label: settingsTextByFlag(L, `ui.tax.vatTreatment.${value}`),
  }));
  const directTaxPresetOptions = [
    { value: "", label: settingsTextByFlag(L, "legacy.0da96b6841aa") },
    ...DIRECT_TAX_PRESETS.map((preset) => ({ value: preset.id, label: settingsTextByFlag(L, `ui.tax.directTaxPresets.${preset.labelKey}`) })),
  ];
  function selectDirectTaxPreset(value: string) {
    const preset = DIRECT_TAX_PRESETS.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      defaultDirectTaxActivityId: value,
      businessActivities: preset ? applyDirectTaxPreset(current.businessActivities, preset) : current.businessActivities,
    }));
    mark();
  }
  return (
    <>
      <div className="sticky top-0 z-30 -mx-3 mb-4 hidden min-h-16 items-center justify-between gap-4 border-b border-border bg-canvas px-3 py-2 md:flex md:-mx-7 md:px-7">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{settingsTextByFlag(L, "legacy.f2f25ea19d25")}</h1>
          <p className="mt-0.5 text-[10px] italic text-slate-400">{settingsTextByFlag(L, "legacy.182380bace9e")}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-[11px]", error ? "text-er" : "text-slate-500")}>
            {error || (dirty ? (settingsTextByFlag(L, "legacy.3bf5caaee8b4")) : saved ? (settingsTextByFlag(L, "legacy.e8f6c0afb49d")) : "")}
          </span>
          {canManage && (
            <Button disabled={!dirty} loading={pending} onClick={save}>
              {!pending && <Check />}
              {settingsTextByFlag(L, "legacy.2d7e281f1bcd")}
            </Button>
          )}
        </div>
      </div>
      <Card title={settingsTextByFlag(L, "legacy.1e881eccdabb")} vi={settingsTextByFlag(L, "legacy.3c2bb7488041")}>
        <div className="grid gap-4 p-4.5 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <span id="taxpayer-type-label" className={FL}>{settingsTextByFlag(L, "legacy.d795c86a7e4e")}</span>
            <Select aria-labelledby="taxpayer-type-label" disabled={!canManage} value={form.taxpayerType} onValueChange={(value) => set("taxpayerType", value as typeof form.taxpayerType)} options={taxpayerTypeOptions} rootClassName="w-full" menuMinWidth={320} wrapLabel />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span id="tax-calculation-method-label" className={FL}>{settingsTextByFlag(L, "legacy.835061cc49c8")}</span>
            <Select aria-labelledby="tax-calculation-method-label" disabled={!canManage} value={form.calculationMethod} onValueChange={(value) => set("calculationMethod", value as typeof form.calculationMethod)} options={calculationMethodOptions} rootClassName="w-full" menuMinWidth={520} wrapLabel />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span id="tax-filing-frequency-label" className={FL}>{settingsTextByFlag(L, "legacy.d20df8de1d87")}</span>
            <Select aria-labelledby="tax-filing-frequency-label" disabled={!canManage} value={form.filingFrequency} onValueChange={(value) => set("filingFrequency", value as typeof form.filingFrequency)} options={filingFrequencyOptions} rootClassName="w-full" menuMinWidth={320} wrapLabel />
          </div>
          <label className="flex min-w-0 flex-col gap-2">
            <span className={FL}>{settingsTextByFlag(L, "legacy.4d1333bf2034")}</span>
            <input type="date" disabled={!canManage} value={form.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)} className={FI} />
          </label>
        </div>
        {form.calculationMethod === "unconfigured" && (
          <div className="px-4.5 pb-4.5">
            <p className="rounded-lg border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[11px] leading-relaxed text-warn">
              {settingsTextByFlag(L, "legacy.71896b3892b3")}
            </p>
          </div>
        )}
      </Card>

      {form.calculationMethod === "revenue_percentage" && (
        <Card title={settingsTextByFlag(L, "legacy.c9b1cd76e0d0")} vi={settingsTextByFlag(L, "legacy.f38abc4a3ffc")}>
          <div className="flex flex-col gap-2 p-3.5">
            <div className="flex min-w-0 flex-col gap-2">
              <span id="direct-tax-rate-label" className={FL}>{settingsTextByFlag(L, "legacy.f26b2c0033c1")}</span>
              <Select aria-labelledby="direct-tax-rate-label" disabled={!canManage} value={form.defaultDirectTaxActivityId} onValueChange={selectDirectTaxPreset} options={directTaxPresetOptions} rootClassName="w-full" menuMinWidth={720} wrapLabel />
              <span className="block text-[10px] leading-relaxed text-slate-500">
                {settingsTextByFlag(L, "legacy.584dd01e1c27")}
              </span>
            </div>
            <CtrlRow
              title={settingsTextByFlag(L, "legacy.3c73f3977389")}
              desc={settingsTextByFlag(L, "legacy.ec0ee2a9227d", { percent: DIRECT_TAX_REDUCTION_PERCENT })}
              checked={form.defaultTaxReductionOnTransaction}
              onChange={canManage ? (value) => set("defaultTaxReductionOnTransaction", value) : undefined}
            />
            <CtrlRow
              title={settingsTextByFlag(L, "legacy.b7a138ca9e8c")}
              desc={settingsTextByFlag(L, "legacy.1e44c6c1b158")}
              checked={form.defaultTaxReductionForAllProducts}
              onChange={canManage ? (value) => set("defaultTaxReductionForAllProducts", value) : undefined}
            />
            <p className="rounded-[10px] border border-warn/25 bg-warn-soft px-3 py-2 text-[10px] leading-relaxed text-warn">
              {settingsTextByFlag(L, "legacy.2766f698cfde")}
            </p>
          </div>
        </Card>
      )}

      <Card title={settingsTextByFlag(L, "legacy.67d61854e7b0")} vi={settingsTextByFlag(L, "legacy.e22d3deaaf41")}>
        <div className="grid gap-3 p-3.5 md:grid-cols-2">
          <label className="space-y-1.5"><span className={FL}>{settingsTextByFlag(L, "legacy.1a69f60027ed")}</span><input disabled={!canManage} value={form.taxpayerName} onChange={(event) => set("taxpayerName", event.target.value)} className={FI} maxLength={200} /></label>
          <label className="space-y-1.5"><span className={FL}>{settingsTextByFlag(L, "legacy.9a3f40f892dd")}</span><input disabled={!canManage} value={form.formerTaxCode} onChange={(event) => set("formerTaxCode", event.target.value)} className={FI} maxLength={30} /></label>
          <label className="space-y-1.5"><span className={FL}>{settingsTextByFlag(L, "legacy.424014f49dcf")}</span><input type="email" disabled={!canManage} value={form.taxpayerEmail} onChange={(event) => set("taxpayerEmail", event.target.value)} className={FI} maxLength={254} /></label>
          <label className="space-y-1.5 md:col-span-2"><span className={FL}>{settingsTextByFlag(L, "legacy.886eabd43286")}</span><input disabled={!canManage} value={form.taxpayerAddress} onChange={(event) => set("taxpayerAddress", event.target.value)} className={FI} maxLength={300} /></label>
        </div>
      </Card>

      <Card title={settingsTextByFlag(L, "legacy.118edd864453")} vi={settingsTextByFlag(L, "legacy.c9d915f2cb4b")}>
        <div className="p-3.5 flex flex-col gap-1.5">
          <div className="mb-2 flex min-w-0 flex-col gap-2">
            <span id="vat-treatment-label" className={FL}>{settingsTextByFlag(L, "legacy.1e04dd0a2947")}</span>
            <Select aria-labelledby="vat-treatment-label" disabled={!canManage} value={form.vatTreatment} onValueChange={(value) => {
              const treatment = value as typeof form.vatTreatment;
              setForm((current) => ({ ...current, vatTreatment: treatment, autoApplyDefaultVat: treatment === "taxable" && current.autoApplyDefaultVat }));
              mark();
            }} options={vatTreatmentOptions} rootClassName="w-full" menuMinWidth={400} wrapLabel />
          </div>
          {form.vatTreatment === "taxable" && VAT_RATES.map((v) => {
            const on = v.rate === form.defaultRate;
            return (
              <button key={v.rate} type="button" disabled={!canManage} onClick={() => set("defaultRate", v.rate)} className={cn(ROW, "text-left transition", on && "border-primary-500 ring-2 ring-primary-500/20", canManage && "hover:border-primary-400")}>
                <span className={cn("font-mono text-base font-extrabold w-10 shrink-0", pctColor(v.rate))}>{v.rate}%</span>
                <div className="flex-1 min-w-0"><div className="text-xs font-bold">{settingsTextByFlag(L, `ui.tax.vatRates.${v.rate}.title`)}</div><div className="text-[10px] text-slate-500">{settingsTextByFlag(L, `ui.tax.vatRates.${v.rate}.description`)}</div></div>
                {on && <span className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 shrink-0">{settingsTextByFlag(L, "legacy.242be4b0c6c5")}</span>}
              </button>
            );
          })}
          {form.vatTreatment === "taxable" && (
            <label className={cn(ROW, "mt-1")}>
              <span className="flex-1"><span className="block text-xs font-bold">{settingsTextByFlag(L, "legacy.a49b6b85a36f")}</span><span className="block text-[10px] italic text-slate-500">{settingsTextByFlag(L, "legacy.8ef22b88d8fc")}</span></span>
              <NumberInput disabled={!canManage} min={0} max={100} value={form.defaultRate} onChange={(value) => set("defaultRate", value ?? 0)} suffix="%" thousandSeparator={false} className="w-28" />
            </label>
          )}
          <CtrlRow title={settingsTextByFlag(L, "legacy.520dc5c159c3")} desc={settingsTextByFlag(L, "legacy.92f6e5b7362a")} checked={form.autoApplyDefaultVat} onChange={canManage && form.vatTreatment === "taxable" ? (v) => set("autoApplyDefaultVat", v) : undefined} />
          <CtrlRow title={settingsTextByFlag(L, "legacy.99793dc70dcb")} desc={settingsTextByFlag(L, "legacy.2d902814b228")} checked={form.priceIncludesTax} onChange={canManage ? (v) => set("priceIncludesTax", v) : undefined} />
        </div>
      </Card>

      <Card title={settingsTextByFlag(L, "legacy.81869576af6d")} vi={settingsTextByFlag(L, "legacy.c8be17cc7214")} action={canManage ? <button type="button" onClick={addActivity} className={btnS}><Plus className="h-3.5 w-3.5" />{settingsTextByFlag(L, "legacy.9b1c10451b78")}</button> : undefined}>
        <div className="space-y-2 p-3.5">
          {form.businessActivities.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border px-3 py-5 text-center text-xs text-slate-400">{settingsTextByFlag(L, "legacy.5b6684c86ab5")}</p>
          ) : form.businessActivities.map((activity, index) => (
            <div key={activity.id} className="grid gap-2 rounded-[10px] border border-border-soft bg-canvas p-3 md:grid-cols-[minmax(0,1fr)_110px_110px_auto] md:items-end">
              <label className="space-y-1.5"><span className={FL}>{settingsTextByFlag(L, "legacy.bd8d3f19edf0")}</span><input disabled={!canManage} value={activity.name} onChange={(event) => setActivity(index, { name: event.target.value })} className={FI} maxLength={160} /></label>
              <label className="space-y-1.5"><span className={FL}>GTGT</span><NumberInput disabled={!canManage} min={0} max={100} value={activity.vatRate} onChange={(value) => setActivity(index, { vatRate: value ?? 0 })} suffix="%" thousandSeparator={false} /></label>
              <label className="space-y-1.5"><span className={FL}>TNCN</span><NumberInput disabled={!canManage} min={0} max={100} value={activity.pitRate} onChange={(value) => setActivity(index, { pitRate: value ?? 0 })} suffix="%" thousandSeparator={false} /></label>
              {canManage && <button type="button" onClick={() => removeActivity(index)} aria-label={settingsTextByFlag(L, "legacy.467a638d08d5", { name: activity.name || index + 1 })} className={cn(btnS, "text-er")}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
        </div>
      </Card>
      <SaveBar className="md:hidden" L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} error={error} />
    </>
  );
}

function NotificationsSection({
  L,
  prefs,
  canManage,
  availableChannels,
}: {
  L: boolean;
  prefs: StorePrefs["notifications"];
  canManage: boolean;
  availableChannels: { id: string; configured: boolean }[];
}) {
  const [form, setForm] = useState(prefs);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); };
  type TK =
    | "lowStock"
    | "stagnant"
    | "shiftClose"
    | "einvoiceError"
    | "syncDone"
    | "serviceDue"
    | "invoiceCreated"
    | "invoiceCancelled"
    | "purchaseReceived"
    | "purchaseCancelled"
    | "debtChanged"
    | "paymentReceived"
    | "qrPaymentConfirmed"
    | "qrPaymentException";
  const setType = (k: TK, v: boolean) => { setForm((p) => ({ ...p, [k]: v })); mark(); };
  const setChannel = (k: string, v: boolean) => { setForm((p) => ({ ...p, channels: { ...p.channels, [k]: v } })); mark(); };
  const setRoutingRole = (
    category: NotificationCategory,
    role: StaffRole,
    enabled: boolean,
  ) => {
    setForm((previous) => {
      const current = previous.roleRouting[category] as StaffRole[];
      const next = STAFF_ROLES.filter((candidate) =>
        candidate === role ? enabled : current.includes(candidate)
      );
      if (next.length === 0) return previous;
      return {
        ...previous,
        roleRouting: {
          ...previous.roleRouting,
          [category]: next,
        },
      };
    });
    mark();
  };
  function save() { start(async () => { const r = await updateStorePrefs({ notifications: form }); if (r.ok) { setDirty(false); setSaved(true); } }); }

  const types: { k: TK; title: string; desc: string }[] = [
    { k: "lowStock", title: settingsTextByFlag(L, "legacy.b9b474ebb698"), desc: settingsTextByFlag(L, "legacy.0bcb37916708") },
    { k: "stagnant", title: settingsTextByFlag(L, "legacy.c17364a6bbf3"), desc: settingsTextByFlag(L, "legacy.48697b5a9527") },
    { k: "shiftClose", title: settingsTextByFlag(L, "legacy.2e55a239721f"), desc: settingsTextByFlag(L, "legacy.9a9c82ebecf5") },
    { k: "einvoiceError", title: settingsTextByFlag(L, "legacy.06c1d3e0c412"), desc: settingsTextByFlag(L, "legacy.fe218ac4a1ee") },
    { k: "syncDone", title: settingsTextByFlag(L, "legacy.2169b32092b5"), desc: settingsTextByFlag(L, "legacy.0eeb1bf9900d") },
    { k: "serviceDue", title: settingsTextByFlag(L, "legacy.0a88d5f066df"), desc: settingsTextByFlag(L, "legacy.22579e4ecce9") },
    { k: "invoiceCreated", title: settingsTextByFlag(L, "legacy.b4672761abb1"), desc: settingsTextByFlag(L, "legacy.988322cc0014") },
    { k: "invoiceCancelled", title: settingsTextByFlag(L, "legacy.9867c63cf650"), desc: settingsTextByFlag(L, "legacy.6951d20e7ba0") },
    { k: "purchaseReceived", title: settingsTextByFlag(L, "legacy.d3183363028d"), desc: settingsTextByFlag(L, "legacy.f64ab21d6cbd") },
    { k: "purchaseCancelled", title: settingsTextByFlag(L, "legacy.91ee48894067"), desc: settingsTextByFlag(L, "legacy.43f2d46e3898") },
    { k: "debtChanged", title: settingsTextByFlag(L, "legacy.93e17de2010e"), desc: settingsTextByFlag(L, "legacy.00a763912ad9") },
    { k: "paymentReceived", title: settingsTextByFlag(L, "legacy.4a3d08a4add7"), desc: settingsTextByFlag(L, "legacy.0e60b9f7dcd3") },
    { k: "qrPaymentConfirmed", title: settingsTextByFlag(L, "legacy.c25cb9be4779"), desc: settingsTextByFlag(L, "legacy.984e93d75e87") },
    { k: "qrPaymentException", title: settingsTextByFlag(L, "legacy.20f9ea2e4ce0"), desc: settingsTextByFlag(L, "legacy.b5b062a8728a") },
  ];
  const channelView = (id: string) => id === "push"
    ? { ico: "📲", name: "Push" }
    : id === "inApp"
      ? { ico: "🔔", name: settingsTextByFlag(L, "legacy.edacff77af19") }
      : { ico: "🔌", name: id };
  const roleLabel = (role: StaffRole) => ({
    owner: settingsTextByFlag(L, "legacy.24e60d31645c"),
    manager: settingsTextByFlag(L, "legacy.f0fd1990dc43"),
    cashier: settingsTextByFlag(L, "legacy.d5f4adff8e64"),
    warehouse: settingsTextByFlag(L, "legacy.21ff0a4b373f"),
    technician: settingsTextByFlag(L, "legacy.843021669584"),
  }[role]);
  const entityLabel = (entityType: string) => ({
    order: settingsTextByFlag(L, "legacy.4bc11291c21c"),
    purchase: settingsTextByFlag(L, "legacy.32c4ffa7c0f1"),
    customer: settingsTextByFlag(L, "legacy.f3b9133e10c4"),
    supplier: settingsTextByFlag(L, "legacy.a778f2731897"),
    payment: settingsTextByFlag(L, "legacy.6329011de5f8"),
  }[entityType] ?? entityType);
  return (
    <>
      <Card title={settingsTextByFlag(L, "legacy.887bc4bc8781")} vi={settingsTextByFlag(L, "legacy.f147727dcede")}>
        <div className="p-4.5 flex flex-col gap-1.5">
          {types.map((tp) => <CtrlRow key={tp.k} title={tp.title} desc={tp.desc} checked={form[tp.k]} onChange={canManage ? (v) => setType(tp.k, v) : undefined} />)}
        </div>
      </Card>
      <Card
        title={settingsTextByFlag(L, "legacy.2eed00681927")}
        vi={settingsTextByFlag(L, "legacy.e5869286db0e")}
      >
        <div className="p-3.5 flex flex-col gap-2">
          {notificationCategories.map((category) => {
            const typeView = types.find((type) => type.k === category);
            const selectedRoles =
              form.roleRouting[category] as StaffRole[];
            const configurableRoles =
              configurableRolesForNotificationCategory(category);
            const entityRoutes = Object.entries(
              notificationRoutingPolicy[category].entities,
            ) as Array<[string, readonly StaffRole[]]>;
            return (
              <div key={category} className={cn(ROW, "items-start")}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold">
                    {typeView?.title ?? category}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {configurableRoles.map((role) => {
                      const selected = selectedRoles.includes(role);
                      const lastSelected =
                        selected && selectedRoles.length === 1;
                      return (
                        <button
                          key={role}
                          type="button"
                          aria-label={`notifications.route.${category}.${role}`}
                          aria-pressed={selected}
                          disabled={!canManage || lastSelected}
                          title={lastSelected
                            ? (settingsTextByFlag(L, "legacy.c947df15ef62"))
                            : undefined}
                          onClick={() =>
                            setRoutingRole(category, role, !selected)}
                          className={cn(
                            "inline-flex min-h-11 min-w-11 items-center rounded-full border px-3 text-[11px] font-bold transition lg:min-h-8 lg:min-w-0",
                            selected
                              ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
                              : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400",
                            (!canManage || lastSelected) &&
                              "cursor-not-allowed opacity-60",
                          )}
                        >
                          {selected && <Check className="mr-1 h-3.5 w-3.5" />}
                          {roleLabel(role)}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 space-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                    {entityRoutes.map(([entityType, allowedRoles]) => (
                      <div key={entityType}>
                        <span className="font-semibold">
                          {entityLabel(entityType)}:
                        </span>{" "}
                        {allowedRoles.map(roleLabel).join(", ")}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title={settingsTextByFlag(L, "legacy.6c19c3efeeb4")} vi={settingsTextByFlag(L, "legacy.b2520df025b4")}>
        <div className="p-3.5 flex flex-col gap-1.5">
          {availableChannels.map((channel) => {
            const view = channelView(channel.id);
            return (
              <div key={channel.id} className={ROW}>
                <span className="text-lg">{view.ico}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold">{view.name}</div>
                  <div className="text-[9px] text-slate-500">
                    {channel.configured ? (settingsTextByFlag(L, "legacy.d4c553c6bc2f")) : (settingsTextByFlag(L, "legacy.c5c261406d5a"))}
                  </div>
                </div>
                <TouchTargetToggle checked={form.channels[channel.id] === true} disabled={!canManage || !channel.configured} onChange={(v) => setChannel(channel.id, v)} aria-label={view.name} />
              </div>
            );
          })}
        </div>
      </Card>
      <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
    </>
  );
}

type ZaloSecretKey = "appSecret" | "accessToken" | "refreshToken" | "webhookSecret";

function ZaloSecretInput({
  id,
  label,
  value,
  setFlag,
  clear,
  canEdit,
  L,
  onValueChange,
  onClearChange,
}: {
  id: ZaloSecretKey;
  label: string;
  value: string;
  setFlag: boolean;
  clear: boolean;
  canEdit: boolean;
  L: boolean;
  onValueChange: (id: ZaloSecretKey, value: string) => void;
  onClearChange: (id: ZaloSecretKey, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={FL}>{label}</span>
      <input
        className={cn(FI, "font-mono")}
        type="password"
        value={value}
        disabled={!canEdit || clear}
        placeholder={setFlag ? (settingsTextByFlag(L, "legacy.299a2f37de8c")) : ""}
        onChange={(e) => onValueChange(id, e.target.value)}
      />
      <label className="mt-1 flex min-h-11 items-center gap-2 text-[11px] text-slate-500 lg:min-h-0 min-w-11 lg:min-w-0">
        <Checkbox checked={clear} disabled={!canEdit} onChange={(e) => onClearChange(id, e.target.checked)} />
        {settingsTextByFlag(L, "legacy.8afe247b39e8")}
      </label>
    </div>
  );
}

function ShopeeSettingsSection({ L, prefs, canEdit }: { L: boolean; prefs: StorePrefs["shopee"]; canEdit: boolean }) {
  const [partnerKeySet, setPartnerKeySet] = useState(prefs.partnerKeySet);
  const [clearPartnerKey, setClearPartnerKey] = useState(false);
  const [form, setForm] = useState({
    enabled: prefs.enabled,
    environment: prefs.environment,
    region: prefs.region || "VN",
    partnerId: /^\d+$/.test(prefs.partnerId) ? prefs.partnerId : "",
    partnerKey: "",
    redirectPath: prefs.redirectPath || "/api/shopee/callback",
    defaultShopId: prefs.defaultShopId,
    defaultWarehouseId: prefs.defaultWarehouseId,
    syncInventory: prefs.syncInventory,
    syncOrders: prefs.syncOrders,
    syncMessages: prefs.syncMessages,
    autoCreateCustomer: prefs.autoCreateCustomer,
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); setError(""); };
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setForm((p) => ({ ...p, [key]: value })); mark(); };
  function save() {
    start(async () => {
      const res = await updateShopeeSettings({ ...form, clearPartnerKey });
      if (res.ok) {
        setPartnerKeySet(clearPartnerKey ? false : partnerKeySet || Boolean(form.partnerKey.trim()));
        setForm((p) => ({ ...p, partnerKey: "" }));
        setClearPartnerKey(false);
        setDirty(false);
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }
  const callbackUrl = typeof window === "undefined" ? form.redirectPath : `${window.location.origin}${form.redirectPath.startsWith("/") ? form.redirectPath : `/${form.redirectPath}`}`;
  return (
    <>
      <Card title={settingsTextByFlag(L, "legacy.a6e8871843dd")} vi={settingsTextByFlag(L, "legacy.3873df3af493")}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold",
              form.enabled ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500"
            )}>
              {form.enabled ? (settingsTextByFlag(L, "legacy.154bec51baa8")) : (settingsTextByFlag(L, "legacy.29712c0cd824"))}
            </span>
            <Link href={Routes.OnlineSales} className={btnS}>{settingsTextByFlag(L, "legacy.e442a4cc7ca5")}</Link>
            <a href="https://open.shopee.com/" target="_blank" rel="noreferrer" className={btnS}>
              <ExternalLink className="w-3 h-3" /> {settingsTextByFlag(L, "legacy.db3af85c7589")}
            </a>
          </div>
          <CtrlRow
            title={settingsTextByFlag(L, "legacy.d58e5b4189bb")}
            desc={settingsTextByFlag(L, "legacy.f7f181f444b6")}
            checked={form.enabled}
            onChange={(value) => set("enabled", value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.3efba0fdd616")}</span>
              <Select
                value={form.environment}
                onChange={(e) => set("environment", e.target.value === "production" ? "production" : "sandbox")}
                options={[{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Production" }]}
                disabled={!canEdit}
                className={FI}
              />
            </div>
            <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.73a16b4b1c32")}</span><input className={FI} name="marketplace-region" autoComplete="off" value={form.region} disabled={!canEdit} onChange={(e) => set("region", e.target.value.toUpperCase())} /></div>
            <div className="flex flex-col gap-1"><span className={FL}>Shopee Partner ID</span><input className={cn(FI, "font-mono")} name="shopee-partner-id" autoComplete="off" inputMode="numeric" value={form.partnerId} disabled={!canEdit} onChange={(e) => set("partnerId", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>Partner key</span>
              <input
                className={cn(FI, "font-mono")}
                type="password"
                name="shopee-partner-key"
                autoComplete="new-password"
                value={form.partnerKey}
                disabled={!canEdit || clearPartnerKey}
                placeholder={partnerKeySet ? (settingsTextByFlag(L, "legacy.b3cd56883157")) : (settingsTextByFlag(L, "legacy.38655a2b9fca"))}
                onChange={(e) => set("partnerKey", e.target.value)}
              />
              <label className="mt-1 flex min-h-11 items-center gap-2 text-[11px] text-slate-500 lg:min-h-0 min-w-11 lg:min-w-0">
                <Checkbox checked={clearPartnerKey} disabled={!canEdit} onChange={(e) => { setClearPartnerKey(e.target.checked); mark(); }} />
                {settingsTextByFlag(L, "legacy.8ef32aa218d6")}
              </label>
            </div>
            <div className="flex flex-col gap-1"><span className={FL}>OAuth callback</span><input className={cn(FI, "font-mono")} name="shopee-oauth-callback" autoComplete="off" value={form.redirectPath} disabled={!canEdit} onChange={(e) => set("redirectPath", e.target.value)} /><span className="text-[11px] text-slate-500 break-all">{callbackUrl}</span></div>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {settingsTextByFlag(L, "legacy.0dfaa5ed39b5")}
          </div>
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{settingsTextByFlag(L, "legacy.9d47ccfe5585")}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (settingsTextByFlag(L, "legacy.3bf5caaee8b4")) : (settingsTextByFlag(L, "legacy.e8f6c0afb49d")))}</span>
          <button disabled={!dirty || pending} onClick={save} className={cn(btnF, "disabled:opacity-50")}>
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{settingsTextByFlag(L, "legacy.2d7e281f1bcd")}
          </button>
        </div>
      )}
    </>
  );
}

function ZaloSection({ L, prefs, canEdit }: { L: boolean; prefs: StorePrefs["zalo"]; canEdit: boolean }) {
  const [form, setForm] = useState({
    enabled: prefs.enabled,
    deliveryMode: prefs.deliveryMode,
    oaId: prefs.oaId,
    appId: prefs.appId,
    appSecret: "",
    accessToken: "",
    refreshToken: "",
    webhookSecret: "",
    portalTemplateId: prefs.portalTemplateId,
    invoiceTemplateId: prefs.invoiceTemplateId,
    debtTemplateId: prefs.debtTemplateId,
  });
  const [secretSet, setSecretSet] = useState({
    appSecret: prefs.appSecretSet,
    accessToken: prefs.accessTokenSet,
    refreshToken: prefs.refreshTokenSet,
    webhookSecret: prefs.webhookSecretSet,
  });
  const [clearSecret, setClearSecret] = useState({
    appSecret: false,
    accessToken: false,
    refreshToken: false,
    webhookSecret: false,
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); setError(""); };
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setForm((p) => ({ ...p, [key]: value })); mark(); };
  const setSecretValue = (key: ZaloSecretKey, value: string) => set(key, value);
  const setClear = (key: ZaloSecretKey, value: boolean) => { setClearSecret((p) => ({ ...p, [key]: value })); mark(); };
  const isZnsMode = form.deliveryMode === "zns";
  const connected = form.enabled && Boolean(form.oaId.trim()) && Boolean(form.appId.trim()) && (secretSet.accessToken || Boolean(form.accessToken.trim()));
  const znsReady = connected && Boolean(form.portalTemplateId || form.invoiceTemplateId || form.debtTemplateId);
  const channelReady = isZnsMode ? znsReady : connected;
  function save() {
    start(async () => {
      const res = await updateZaloSettings({
        ...form,
        clearAppSecret: clearSecret.appSecret,
        clearAccessToken: clearSecret.accessToken,
        clearRefreshToken: clearSecret.refreshToken,
        clearWebhookSecret: clearSecret.webhookSecret,
      });
      if (res.ok) {
        setSecretSet({
          appSecret: clearSecret.appSecret ? false : secretSet.appSecret || Boolean(form.appSecret.trim()),
          accessToken: clearSecret.accessToken ? false : secretSet.accessToken || Boolean(form.accessToken.trim()),
          refreshToken: clearSecret.refreshToken ? false : secretSet.refreshToken || Boolean(form.refreshToken.trim()),
          webhookSecret: clearSecret.webhookSecret ? false : secretSet.webhookSecret || Boolean(form.webhookSecret.trim()),
        });
        setForm((p) => ({ ...p, appSecret: "", accessToken: "", refreshToken: "", webhookSecret: "" }));
        setClearSecret({ appSecret: false, accessToken: false, refreshToken: false, webhookSecret: false });
        setDirty(false);
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }
  return (
    <>
      <Card
        title={settingsTextByFlag(L, "legacy.2c6494d86f34")}
        vi={settingsTextByFlag(L, "legacy.e4d855486d10")}
        action={<TouchTargetToggle checked={form.enabled} onChange={canEdit ? (v) => set("enabled", v) : () => {}} aria-label="zalo" />}
      >
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold",
              channelReady ? "bg-ok-soft text-ok" : connected ? "bg-in-soft text-in" : "bg-warn-soft text-warn"
            )}>
              <MessageCircle className="h-3.5 w-3.5" />
              {channelReady
                ? isZnsMode
                  ? (settingsTextByFlag(L, "legacy.2a4c34033786"))
                  : (settingsTextByFlag(L, "legacy.8cdf06eab520"))
                : connected
                  ? (settingsTextByFlag(L, "legacy.bb3448ecc6dd"))
                  : (settingsTextByFlag(L, "legacy.832ddc21260a"))}
            </span>
            {isZnsMode && connected && !znsReady && (
              <span className="text-[11px] font-semibold text-slate-500">
                {settingsTextByFlag(L, "legacy.242e04d44a0f")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.7fcdb26cd1c9")}</span>
              <Select
                className="w-full"
                disabled={!canEdit}
                value={form.deliveryMode}
                options={[
                  { value: "oa", label: settingsTextByFlag(L, "legacy.6121adc526f7") },
                  { value: "zns", label: settingsTextByFlag(L, "legacy.64bb9b14ba03") },
                ]}
                onValueChange={(value) => set("deliveryMode", value === "zns" ? "zns" : "oa")}
              />
            </div>
            <div className="flex flex-col gap-1"><span className={FL}>OA ID</span><input className={cn(FI, "font-mono")} value={form.oaId} disabled={!canEdit} onChange={(e) => set("oaId", e.target.value)} /></div>
            <div className="flex flex-col gap-1"><span className={FL}>App ID</span><input className={cn(FI, "font-mono")} value={form.appId} disabled={!canEdit} onChange={(e) => set("appId", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ZaloSecretInput id="accessToken" label="OA access token" value={form.accessToken} setFlag={secretSet.accessToken} clear={clearSecret.accessToken} canEdit={canEdit} L={L} onValueChange={setSecretValue} onClearChange={setClear} />
            <ZaloSecretInput id="refreshToken" label="OA refresh token" value={form.refreshToken} setFlag={secretSet.refreshToken} clear={clearSecret.refreshToken} canEdit={canEdit} L={L} onValueChange={setSecretValue} onClearChange={setClear} />
            <ZaloSecretInput id="appSecret" label="App secret" value={form.appSecret} setFlag={secretSet.appSecret} clear={clearSecret.appSecret} canEdit={canEdit} L={L} onValueChange={setSecretValue} onClearChange={setClear} />
            <ZaloSecretInput id="webhookSecret" label="Webhook secret" value={form.webhookSecret} setFlag={secretSet.webhookSecret} clear={clearSecret.webhookSecret} canEdit={canEdit} L={L} onValueChange={setSecretValue} onClearChange={setClear} />
          </div>
          {isZnsMode && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.c2cd41ad23bb")}</span><input className={cn(FI, "font-mono")} value={form.portalTemplateId} disabled={!canEdit} onChange={(e) => set("portalTemplateId", e.target.value)} /></div>
              <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.13d721b048ea")}</span><input className={cn(FI, "font-mono")} value={form.invoiceTemplateId} disabled={!canEdit} onChange={(e) => set("invoiceTemplateId", e.target.value)} /></div>
              <div className="flex flex-col gap-1"><span className={FL}>{settingsTextByFlag(L, "legacy.f5a4c33ef6c8")}</span><input className={cn(FI, "font-mono")} value={form.debtTemplateId} disabled={!canEdit} onChange={(e) => set("debtTemplateId", e.target.value)} /></div>
            </div>
          )}
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {settingsTextByFlag(L, "legacy.5d740bef6a90")}
          </div>
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{settingsTextByFlag(L, "legacy.90581ba97c26")}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (settingsTextByFlag(L, "legacy.3bf5caaee8b4")) : (settingsTextByFlag(L, "legacy.e8f6c0afb49d")))}</span>
          <button disabled={!dirty || pending} onClick={save} className={cn(btnF, "disabled:opacity-50")}>
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{settingsTextByFlag(L, "legacy.2d7e281f1bcd")}
          </button>
        </div>
      )}
    </>
  );
}

function AiSection({ L, prefs, canEdit, usage }: { L: boolean; prefs: StorePrefs["ai"]; canEdit: boolean; usage: AiUsageStatus }) {
  const [openaiApiKeySet, setOpenaiApiKeySet] = useState(prefs.openaiApiKeySet);
  const [form, setForm] = useState<{
    provider: AiProvider;
    textModel: AiTextModel;
    visionModel: AiVisionModel;
    openaiApiKey: string;
    openaiVisionModel: AiVisionModel;
    monthlyUsageLimit: number;
    showFloatingLauncher: boolean;
  }>({
    provider: coerceAiProvider(prefs.provider),
    textModel: coerceAiTextModel(prefs.textModel),
    visionModel: coerceAiVisionModel(prefs.visionModel || prefs.openaiVisionModel),
    openaiApiKey: "",
    openaiVisionModel: coerceAiVisionModel(prefs.visionModel || prefs.openaiVisionModel),
    monthlyUsageLimit: prefs.monthlyUsageLimit,
    showFloatingLauncher: prefs.showFloatingLauncher,
  });
  const [clearOpenaiApiKey, setClearOpenaiApiKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState<AiProviderTestKind | null>(null);
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); setError(""); setTestResult(null); setTestError(""); };
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => { setForm((p) => ({ ...p, [key]: value })); mark(); };
  const toggleClearKey = (value: boolean) => { setClearOpenaiApiKey(value); mark(); };
  async function runProviderTest(kind: AiProviderTestKind) {
    setTesting(kind);
    setTestError("");
    const res = await testAiProvider({ ...form, clearOpenaiApiKey }, kind).catch(() => null);
    if (res?.ok) {
      setTestResult(res.data);
    } else {
      setTestResult(null);
      setTestError(res?.error ?? "errors.serverError");
    }
    setTesting(null);
  }
  function save() {
    start(async () => {
      const res = await updateAiSettings({ ...form, clearOpenaiApiKey });
      if (res.ok) {
        setOpenaiApiKeySet(clearOpenaiApiKey ? false : openaiApiKeySet || Boolean(form.openaiApiKey.trim()));
        setForm((p) => ({ ...p, openaiApiKey: "" }));
        setClearOpenaiApiKey(false);
        setDirty(false);
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }
  const configured = clearOpenaiApiKey ? false : openaiApiKeySet || Boolean(form.openaiApiKey.trim());
  const displayLimit = Math.max(0, Math.min(100000, Math.trunc(Number(form.monthlyUsageLimit) || 0)));
  const displayRemaining = Math.max(0, displayLimit - usage.used);
  const displayExhausted = displayRemaining <= 0;
  const limitPreviewChanged = displayLimit !== usage.limit;
  const limitPreviewEffect = limitPreviewChanged ? settingsTextByFlag(L, "legacy.8a8478eae228") : "";
  const diagnosticsRows: Array<[string, string, boolean]> = [
    [settingsTextByFlag(L, "legacy.e52086d77002"), AI_PROVIDER_OPTIONS.find((item) => item.value === form.provider)?.label ?? form.provider, true],
    [settingsTextByFlag(L, "legacy.c3b8ce820623"), form.textModel, true],
    [settingsTextByFlag(L, "legacy.4c603a4587fd"), form.visionModel, form.provider !== "deepseek"],
    [settingsTextByFlag(L, "legacy.29aea4bc18f1"), configured ? (settingsTextByFlag(L, "legacy.3d9c2c3792fd")) : (settingsTextByFlag(L, "legacy.9396719137cc")), configured],
    [settingsTextByFlag(L, "legacy.f3d0db036f26"), settingsTextByFlag(L, "legacy.2f6121b0abfd"), true],
    [settingsTextByFlag(L, "legacy.30d3001ba776"), form.provider === "deepseek" ? (settingsTextByFlag(L, "legacy.3a81bde116b9")) : (settingsTextByFlag(L, "legacy.2f6121b0abfd")), form.provider !== "deepseek"],
  ];
  return (
    <>
      <Card title={settingsTextByFlag(L, "legacy.5f2e88c09d4c")} vi={settingsTextByFlag(L, "legacy.58bd995dda76")}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold",
              configured ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
            )}>
              {configured ? (settingsTextByFlag(L, "legacy.d93ca6c76e55")) : (settingsTextByFlag(L, "legacy.268a460390e9"))}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.e52086d77002")}</span>
              <SearchableSelect
                options={AI_PROVIDER_OPTIONS}
                value={form.provider}
                onChange={(value) => {
                  const provider = coerceAiProvider(value);
                  const visionModel = defaultVisionModelForProvider(provider);
                  setForm((p) => ({
                    ...p,
                    provider,
                    textModel: defaultTextModelForProvider(provider),
                    visionModel,
                    openaiVisionModel: visionModel,
                  }));
                  mark();
                }}
                allowClear={false}
                showSearch={false}
                disabled={!canEdit}
                className={searchableTouch}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.c529a1e20292")}</span>
              <input
                className={cn(FI, "font-mono")}
                type="password"
                value={form.openaiApiKey}
                disabled={!canEdit || clearOpenaiApiKey}
                placeholder={providerKeyPlaceholder(form.provider, openaiApiKeySet, L)}
                onChange={(e) => set("openaiApiKey", e.target.value)}
              />
              <span className="text-[11px] text-slate-500">{providerKeyHelp(form.provider, L)}</span>
              <label className="mt-1 flex min-h-11 items-center gap-2 text-[11px] text-slate-500 lg:min-h-0 min-w-11 lg:min-w-0">
                <Checkbox checked={clearOpenaiApiKey} disabled={!canEdit} onChange={(e) => toggleClearKey(e.target.checked)} />
                {settingsTextByFlag(L, "legacy.816e58b4c8ea")}
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.d2b6d68bd98c")}</span>
              <SearchableSelect
                options={AI_TEXT_MODEL_OPTIONS}
                value={form.textModel}
                onChange={(value) => set("textModel", coerceAiTextModel(value))}
                allowClear={false}
                showSearch={false}
                disabled={!canEdit}
                className={searchableTouch}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.a62d98d9b055")}</span>
              <SearchableSelect
                options={AI_MODEL_OPTIONS}
                value={form.visionModel}
                onChange={(value) => {
                  const model = coerceAiVisionModel(value);
                  setForm((p) => ({ ...p, visionModel: model, openaiVisionModel: model }));
                  mark();
                }}
                allowClear={false}
                showSearch={false}
                disabled={!canEdit}
                className={searchableTouch}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.f84bb7aabc7a")}</span>
              <div className={cn(FI, "flex items-center justify-between gap-3 bg-canvas")}
                aria-label={settingsTextByFlag(L, "legacy.d6f0627586d2")}>
                <span className="font-semibold text-slate-800 dark:text-slate-100">Cloudflare R2 (managed)</span>
                <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok">
                  {settingsTextByFlag(L, "legacy.6c3f44c37882")}
                </span>
              </div>
              <span className="text-[11px] leading-relaxed text-slate-500">
                {settingsTextByFlag(L, "legacy.cbcbf33f008b")}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{settingsTextByFlag(L, "legacy.6d00c82adf73")}</span>
              <NumberInput
                className={cn(FI, "font-mono")}
                min={0}
                max={100000}
                step={1}
                value={form.monthlyUsageLimit}
                disabled={!canEdit}
                onChange={(value) => set("monthlyUsageLimit", Math.trunc(value ?? 0))}
              />
            </div>
          </div>
          <CtrlRow
            title={settingsTextByFlag(L, "legacy.422a09840268")}
            desc={settingsTextByFlag(L, "legacy.b6fbbd5d3664")}
            checked={form.showFloatingLauncher}
            onChange={(value) => set("showFloatingLauncher", value)}
          />
          <div className="grid grid-cols-3 gap-2">
            {[
              [settingsTextByFlag(L, "legacy.ec152bad9d84"), usage.used],
              [settingsTextByFlag(L, "legacy.050069d3ca8b"), displayRemaining],
              [settingsTextByFlag(L, "legacy.fcb5b52800b7"), displayLimit],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[10px] border border-border bg-canvas px-3 py-2">
                <div className={FL}>{label}</div>
                <div className={cn("mt-1 font-mono text-base font-extrabold", label === (settingsTextByFlag(L, "legacy.050069d3ca8b")) && displayExhausted ? "text-er" : "text-slate-800 dark:text-slate-100")}>{Number(value).toLocaleString("vi-VN")}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {[
              [settingsTextByFlag(L, "legacy.57cbd03ff2e9"), usage.inputTokens.toLocaleString("vi-VN")],
              [settingsTextByFlag(L, "legacy.a237f74e8d0c"), usage.outputTokens.toLocaleString("vi-VN")],
              [settingsTextByFlag(L, "legacy.480b4d2fae41"), usage.totalTokens.toLocaleString("vi-VN")],
              [settingsTextByFlag(L, "legacy.2d1ba2c485dd"), `$${usage.estimatedCostUsd.toFixed(4)}`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[10px] border border-border bg-canvas px-3 py-2">
                <div className={FL}>{label}</div>
                <div className="mt-1 font-mono text-sm font-extrabold text-slate-800 dark:text-slate-100">{value}</div>
              </div>
            ))}
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {settingsTextByFlag(L, "legacy.4909d9facb90", {
              period: usage.period,
              effect: limitPreviewEffect,
            })}
          </div>
        </div>
      </Card>
      <Card title={settingsTextByFlag(L, "legacy.c070b430375b")} vi={settingsTextByFlag(L, "legacy.3d35f8f51e50")}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {diagnosticsRows.map(([label, value, ok]) => (
              <div key={String(label)} className="rounded-[10px] border border-border bg-canvas px-3 py-2">
                <div className={FL}>{label}</div>
                <div className={cn("mt-1 text-xs font-extrabold", ok ? "text-slate-800 dark:text-slate-100" : "text-warn")}>{value}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEdit || testing !== null}
              onClick={() => void runProviderTest("text")}
              className={cn(btnF, "disabled:opacity-50")}
            >
              {testing === "text" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {settingsTextByFlag(L, "legacy.f650a9d3506c")}
            </button>
            <button
              type="button"
              disabled={!canEdit || testing !== null || form.provider === "deepseek"}
              onClick={() => void runProviderTest("vision")}
              className={cn(btnS, "disabled:opacity-50")}
            >
              {testing === "vision" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {settingsTextByFlag(L, "legacy.330f5c579c80")}
            </button>
          </div>
          {testResult && (
            <div className={cn(
              "rounded-[10px] border px-3.5 py-2.5 text-[11px] leading-relaxed",
              testResult.ok ? "border-ok/20 bg-ok-soft text-ok" : "border-warn/20 bg-warn-soft text-warn"
            )}>
              <div className="font-bold">
                {testResult.kind === "text" ? "Text" : "Vision"} · {testResult.ok ? (settingsTextByFlag(L, "legacy.7df9017eeff6")) : (settingsTextByFlag(L, "legacy.6e7ad658067f"))}
              </div>
              <div className="mt-1">
                {settingsTextByFlag(L, "legacy.6cb54b294cf0")}: {formatAiTestMessage(testResult.message, L)}
                {testResult.tokenUsage ? ` · tokens ${testResult.tokenUsage.totalTokens}` : ""}
              </div>
              <div className="mt-1 text-[10px] opacity-75">{new Date(testResult.testedAt).toLocaleString("vi-VN")}</div>
            </div>
          )}
          {testError && <div className="rounded-[10px] border border-er/20 bg-er-soft px-3.5 py-2.5 text-[11px] font-semibold text-er">{testError}</div>}
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{settingsTextByFlag(L, "legacy.535f3902ad18")}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (settingsTextByFlag(L, "legacy.3bf5caaee8b4")) : (settingsTextByFlag(L, "legacy.e8f6c0afb49d")))}</span>
          <button disabled={!dirty || pending} onClick={save} className={cn(btnF, "disabled:opacity-50")}>
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{settingsTextByFlag(L, "legacy.2d7e281f1bcd")}
          </button>
        </div>
      )}
    </>
  );
}

function CtrlRow({ title, desc, checked, onChange }: { title: string; desc?: string; checked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className={ROW}>
      <div className="flex-1 mr-3">
        <div className="text-xs font-bold">{title}</div>
        {desc && <div className="text-[10px] italic text-slate-500 mt-px">{desc}</div>}
      </div>
      <TouchTargetToggle checked={checked} onChange={onChange ?? (() => {})} aria-label={title} />
    </div>
  );
}

function SaveBar({ L, labels, dirty, saved, pending, canManage, onSave, error = "", className }: { L: boolean; labels?: { permission: string; unsaved: string; saved: string; save: string }; dirty: boolean; saved: boolean; pending: boolean; canManage: boolean; onSave: () => void; error?: string; className?: string }) {
  const copy = labels ?? {
    permission: settingsTextByFlag(L, "legacy.f2daa8f757fc"),
    unsaved: settingsTextByFlag(L, "legacy.3bf5caaee8b4"),
    saved: settingsTextByFlag(L, "legacy.e8f6c0afb49d"),
    save: settingsTextByFlag(L, "legacy.2d7e281f1bcd"),
  };
  if (!canManage) return <p className={cn("text-[11px] text-slate-400 italic mt-1", className)}>{copy.permission}</p>;
  if (!dirty && !saved) return null;
  return (
    <div className={cn("flex items-center gap-2 pt-1", className)}>
      <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? copy.unsaved : copy.saved)}</span>
      <button disabled={!dirty || pending} onClick={onSave} className={cn(btnF, "disabled:opacity-50")}>
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{copy.save}
      </button>
    </div>
  );
}
