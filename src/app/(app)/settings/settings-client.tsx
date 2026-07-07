"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, KeyRound, Loader2, MessageCircle, Pencil, Plus, Power, Printer, Save, Star, Trash2, X } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { Select } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/normalize";
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
} from "@/lib/actions/settings";
import type { PaymentBankAccountRow, StoreSettings, StaffRow } from "@/lib/data/settings";
import {
  AI_ATTACHMENT_BUCKETS,
  AI_PROVIDERS,
  AI_TEXT_MODELS,
  AI_VISION_MODELS,
  STAFF_ROLES,
  PAPER_SIZES,
  type StaffRole,
  type PaymentBankAccountInput,
  type StorePrefs,
} from "@/lib/schemas/settings";

/* ── sample data (design preview — chưa nối backend) ── */
const ROLE_LABELS: Record<string, [string, string]> = {
  owner: ["Owner", "Chủ cửa hàng"], manager: ["Manager", "Quản lý"],
  cashier: ["Cashier", "Thu ngân"], stock: ["Stock-keeper", "Thủ kho"], accountant: ["Accountant", "Kế toán"],
};
const PERMS: { en: string; vi: string; roles: Record<string, boolean> }[] = [
  { en: "Process sales", vi: "Thực hiện bán hàng", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { en: "Apply discount", vi: "Áp dụng giảm giá", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { en: "Price override", vi: "Ghi đè giá bán", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Process refund", vi: "Thực hiện hoàn tiền", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Void / delete invoice", vi: "Hủy hóa đơn", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Add / edit products", vi: "Thêm / sửa sản phẩm", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { en: "Stock inbound", vi: "Nhập kho", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { en: "View reports", vi: "Xem báo cáo", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: true } },
  { en: "Settings access", vi: "Truy cập cài đặt", roles: { owner: true, manager: false, cashier: false, stock: false, accountant: false } },
];
const DEVICES = [
  { ico: "🖨️", name: "XPrinter XP-N260L", en: "Thermal Printer 80mm", vi: "Máy in nhiệt 80mm", status: "connected", detail: "USB · COM3" },
  { ico: "📷", name: "Honeywell Voyager 1250g", en: "Barcode Scanner", vi: "Máy quét mã vạch", status: "connected", detail: "USB HID · Wedge" },
  { ico: "🗃️", name: "APG Vasario 1416", en: "Cash Drawer", vi: "Ngăn kéo tiền", status: "connected", detail: "Triggered via printer" },
  { ico: "⚖️", name: "CAS SW-1S", en: "Weighing Scale", vi: "Cân điện tử", status: "disconnected", detail: "COM4 · not responding" },
  { ico: "💳", name: "POS terminal / SoftPOS", en: "Card Reader / mPOS", vi: "Đầu đọc thẻ", status: "unconfigured", detail: "Configure in Payments" },
];
const PAYMENTS = [
  { ico: "💵", name: "Cash", vi: "Tiền mặt", id: "cash", enabled: true, color: "#15803D", note: "Always available · change calc built-in" },
  { ico: "📱", name: "VietQR / Napas", vi: "VietQR", id: "qr", enabled: true, color: "#1D4ED8", note: "Dynamic QR · auto-confirm · Napas" },
  { ico: "🟣", name: "MoMo", vi: "Ví MoMo", id: "momo", enabled: true, color: "#A50064", note: "Deep-link + webhook · timeout 90s" },
  { ico: "🔵", name: "ZaloPay", vi: "Ví ZaloPay", id: "zalopay", enabled: false, color: "#006AFF", note: "Not yet configured — tap to set up" },
  { ico: "🔴", name: "VNPay", vi: "VNPay", id: "vnpay", enabled: false, color: "#CC0000", note: "Not yet configured — tap to set up" },
  { ico: "💳", name: "Card / SoftPOS", vi: "Thẻ / mPOS", id: "card", enabled: false, color: "#374151", note: "Connect card reader in Hardware first" },
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
  { rate: 0, en: "Exempt", vi: "Miễn thuế", itemsEn: "Exports, financial services", itemsVi: "Xuất khẩu, dịch vụ tài chính" },
  { rate: 5, en: "Reduced", vi: "Giảm thuế", itemsEn: "Essential food, medicine", itemsVi: "Thực phẩm thiết yếu, dược phẩm" },
  { rate: 8, en: "Standard reduced", vi: "Tiêu chuẩn giảm", itemsEn: "Most goods & services", itemsVi: "Hầu hết hàng hóa & dịch vụ" },
  { rate: 10, en: "Standard", vi: "Tiêu chuẩn", itemsEn: "Electronics, fashion, cosmetics", itemsVi: "Điện tử, thời trang, mỹ phẩm" },
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
const AI_BUCKET_OPTIONS = AI_ATTACHMENT_BUCKETS.map((value) => ({
  value,
  label: value,
  hint: value === "ai-attachments"
    ? "Default"
    : value === "ai-pos-attachments"
      ? "POS only"
      : "Shared AI bucket",
}));
type AiVisionModel = (typeof AI_VISION_MODELS)[number];
type AiProvider = (typeof AI_PROVIDERS)[number];
type AiTextModel = (typeof AI_TEXT_MODELS)[number];
type AiAttachmentBucket = (typeof AI_ATTACHMENT_BUCKETS)[number];
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
  if (keySet) return L ? "Nhập key mới để thay thế" : "Enter a new key to replace";
  if (provider === "gemini") return "AIza...";
  if (provider === "openai") return "sk-...";
  return "sk-... or DeepSeek key";
}
function providerKeyHelp(provider: AiProvider, L: boolean) {
  if (provider === "gemini") {
    return L
      ? "Tạo key trong Google AI Studio, rồi lưu tại đây. Server sẽ dùng key này cho chat và OCR/ảnh."
      : "Create a key in Google AI Studio, then save it here. The server uses this key for chat and vision/OCR.";
  }
  if (provider === "deepseek") {
    return L
      ? "DeepSeek chỉ dùng cho lập kế hoạch text; OCR/ảnh sẽ không khả dụng."
      : "DeepSeek is text-planning only; vision/OCR is unavailable.";
  }
  return L
    ? "Dùng OpenAI API key cho text và OCR/ảnh."
    : "Use an OpenAI API key for text and vision/OCR.";
}
function coerceAiAttachmentBucket(value: string): AiAttachmentBucket {
  return AI_ATTACHMENT_BUCKETS.includes(value as AiAttachmentBucket) ? value as AiAttachmentBucket : "ai-attachments";
}
function formatAiTestMessage(message: string, L: boolean) {
  const map: Record<string, [string, string]> = {
    missing_api_key: ["Missing API key.", "Thiếu API key."],
    unsupported_vision: ["This provider does not support vision/OCR.", "Provider này không hỗ trợ vision/OCR."],
    unsupported_text_planning: ["This provider does not support text planning.", "Provider này không hỗ trợ lập kế hoạch text."],
  };
  return map[message] ? (L ? map[message][1] : map[message][0]) : message;
}

type SectionId = "store" | "staff" | "pos" | "hardware" | "payments" | "print" | "promotions" | "tax" | "notifications" | "zalo" | "shopee" | "ai";

const NAV: { group: [string, string]; items: { id: SectionId; ico: string; en: string; vi: string; badge?: string }[] }[] = [
  { group: ["Store", "Cửa hàng"], items: [
    { id: "store", ico: "🏪", en: "Store Profile", vi: "Thông tin cửa hàng" },
    { id: "staff", ico: "👤", en: "Staff & RBAC", vi: "Nhân viên & Phân quyền" },
  ] },
  { group: ["Operations", "Vận hành"], items: [
    { id: "pos", ico: "🛒", en: "POS Page", vi: "Trang bán hàng POS" },
    { id: "hardware", ico: "🖨️", en: "Hardware", vi: "Thiết bị phần cứng" },
    { id: "payments", ico: "💳", en: "Payments", vi: "Thanh toán" },
    { id: "print", ico: "📄", en: "Print Templates", vi: "Mẫu in", badge: "15.1" },
    { id: "promotions", ico: "%", en: "Promotions", vi: "Khuyến mãi" },
  ] },
  { group: ["Compliance", "Tuân thủ"], items: [
    { id: "tax", ico: "📋", en: "Tax & E-Invoice", vi: "Thuế & HĐ điện tử" },
  ] },
  { group: ["System", "Hệ thống"], items: [
    { id: "notifications", ico: "🔔", en: "Notifications", vi: "Thông báo" },
    { id: "zalo", ico: "💬", en: "Zalo OA", vi: "Zalo OA" },
    { id: "shopee", ico: "🧩", en: "Marketplace Apps", vi: "App sàn TMĐT" },
    { id: "ai", ico: "✨", en: "AI", vi: "AI" },
  ] },
];
const SEC_META: Record<SectionId, { en: string; vi: string; subEn: string; subVi: string }> = {
  store: { en: "Store Profile", vi: "Thông tin cửa hàng", subEn: "Business identity, currency & locale", subVi: "Thông tin doanh nghiệp, tiền tệ & ngôn ngữ" },
  staff: { en: "Staff & RBAC", vi: "Nhân viên & Phân quyền", subEn: "Members and role-based access control", subVi: "Nhân viên và phân quyền theo vai trò" },
  pos: { en: "POS Page", vi: "Trang bán hàng POS", subEn: "Show or hide optional selling controls", subVi: "Ẩn/hiện các trường tùy chọn khi bán hàng" },
  hardware: { en: "Hardware Devices", vi: "Thiết bị phần cứng", subEn: "Printer, scanner, drawer, scale, reader", subVi: "Máy in, quét mã, ngăn kéo, cân, đọc thẻ" },
  payments: { en: "Payment Methods", vi: "Phương thức thanh toán", subEn: "Vietnamese payment ecosystem", subVi: "Hệ sinh thái thanh toán Việt Nam" },
  print: { en: "Print Templates", vi: "Mẫu in", subEn: "Receipt & document template designer", subVi: "Thiết kế mẫu hóa đơn & chứng từ" },
  promotions: { en: "Promotions", vi: "Khuyến mãi", subEn: "Quantity-based product promotions", subVi: "Khuyến mãi sản phẩm theo bậc số lượng" },
  tax: { en: "Tax & E-Invoice", vi: "Thuế & Hóa đơn điện tử", subEn: "VAT rates + Decree 70/2025 e-invoice", subVi: "Thuế GTGT + HĐĐT theo Nghị định 70/2025" },
  notifications: { en: "Notifications", vi: "Thông báo", subEn: "Alert types and channels", subVi: "Loại thông báo và kênh gửi" },
  zalo: { en: "Zalo OA", vi: "Zalo OA", subEn: "Official Account and ZNS templates", subVi: "Official Account và template ZNS" },
  shopee: { en: "Marketplace Developer Apps", vi: "App developer sàn TMĐT", subEn: "Provider credentials and OAuth callbacks", subVi: "Credential provider và OAuth callback" },
  ai: { en: "AI Settings", vi: "Cấu hình AI", subEn: "Provider key, vision model, and attachment bucket", subVi: "API key, model vision và bucket lưu file AI" },
};

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
const FI = "w-full px-[11px] py-[9px] bg-canvas border-[1.5px] border-border rounded-[10px] text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";
const ROW = "flex items-center justify-between gap-3 px-3.5 py-2.5 bg-canvas rounded-[10px] border border-border-soft";
const btnS = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border-soft text-xs font-semibold hover:bg-surface-2 transition";
const btnF = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold hover:brightness-110 transition";

export function SettingsClient({
  store,
  canManage,
  canEditAi,
  initialTab,
  promotionsContent,
}: {
  store: StoreSettings;
  canManage: boolean;
  canEditAi: boolean;
  initialTab?: string;
  promotionsContent: React.ReactNode;
}) {
  const locale = useLocale();
  const tSettings = useTranslations("settings");
  const L = locale === "vi";
  const normalizedInitialTab = initialTab && SEC_META[initialTab as SectionId] ? initialTab as SectionId : null;
  const [active, setActive] = useState<SectionId>(normalizedInitialTab ?? "store");
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<PaymentBankAccountRow[] | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageStatus | null>(null);
  const [lazyLoading, setLazyLoading] = useState<Partial<Record<"staff" | "payments" | "ai", boolean>>>({});
  const [lazyError, setLazyError] = useState<Partial<Record<"staff" | "payments" | "ai", string>>>({});
  useEffect(() => {
    if (normalizedInitialTab) return;
    const saved = localStorage.getItem("lp-settings-active") as SectionId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client sync of persisted section (SSR-safe)
    if (saved && SEC_META[saved]) setActive(saved);
  }, [normalizedInitialTab]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (active === "staff" && staff === null) {
        setLazyLoading((prev) => ({ ...prev, staff: true }));
        const res = await loadSettingsStaff().catch(() => null);
        if (cancelled) return;
        if (res?.ok) setStaff(res.data);
        else setLazyError((prev) => ({ ...prev, staff: res?.error ?? "errors.serverError" }));
        setLazyLoading((prev) => ({ ...prev, staff: false }));
      }
      if (active === "payments" && bankAccounts === null) {
        setLazyLoading((prev) => ({ ...prev, payments: true }));
        const res = await loadSettingsPaymentBankAccounts().catch(() => null);
        if (cancelled) return;
        if (res?.ok) setBankAccounts(res.data);
        else setLazyError((prev) => ({ ...prev, payments: res?.error ?? "errors.serverError" }));
        setLazyLoading((prev) => ({ ...prev, payments: false }));
      }
      if (active === "ai" && aiUsage === null) {
        setLazyLoading((prev) => ({ ...prev, ai: true }));
        const res = await loadSettingsAiUsage().catch(() => null);
        if (cancelled) return;
        if (res?.ok) setAiUsage(res.data);
        else setLazyError((prev) => ({ ...prev, ai: res?.error ?? "errors.serverError" }));
        setLazyLoading((prev) => ({ ...prev, ai: false }));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [active, aiUsage, bankAccounts, staff]);
  const pick = (id: SectionId) => { setActive(id); localStorage.setItem("lp-settings-active", id); };
  const sec = SEC_META[active];
  return (
    <div className="flex h-dvh overflow-hidden">
      {/* settings nav */}
      <nav className="w-55 shrink-0 bg-surface border-r border-border overflow-y-auto hidden md:flex flex-col">
        <div className="px-4 py-3.5 border-b border-border">
          <div className="text-sm font-extrabold">{L ? "Cài đặt" : "Settings"}</div>
          <div className="text-[10px] italic text-slate-400 mt-0.5">{L ? "Cài đặt hệ thống" : "System settings"}</div>
        </div>
        {NAV.map((grp, gi) => (
          <div key={gi}>
            <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{L ? grp.group[1] : grp.group[0]}</div>
            {grp.items.map((it) => (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-l-2 transition",
                  active === it.id
                    ? "bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border-primary-600"
                    : "text-slate-500 border-transparent hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
                )}
              >
                <span className="w-4.5 text-center text-sm shrink-0">{it.ico}</span>
                <span className="flex-1 text-left">{L ? it.vi : it.en}</span>
                {it.badge && <span className="text-[8px] bg-in-soft text-in border border-in/30 rounded-full px-1.5 py-px">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* content */}
      <div className="flex-1 overflow-y-auto px-5 md:px-7 py-6 pb-12">
        {/* mobile section picker */}
        <div className="md:hidden mb-4">
          <Select
            value={active}
            onChange={(e) => pick(e.target.value as SectionId)}
            options={NAV.flatMap((g) => g.items).map((it) => ({ value: it.id, label: L ? it.vi : it.en }))}
            className={FI}
          />
        </div>

        <div className="mb-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-primary-600">
            {tSettings("breadcrumb.settings")} · {tSettings(`breadcrumb.${active}`)}
          </div>
          {active !== "payments" && <h1 className="text-xl font-extrabold tracking-tight">{L ? sec.vi : sec.en}</h1>}
        </div>

        {active === "store" && <StoreSection L={L} locale={locale} store={store} canManage={canManage} />}
        {active === "staff" && (staff ? <StaffSection L={L} staff={staff} canManage={canManage} /> : <LazySectionState L={L} loading={Boolean(lazyLoading.staff)} error={lazyError.staff} />)}
        {active === "pos" && <PosSettingsSection L={L} prefs={store.prefs.pos} canManage={canManage} />}
        {active === "hardware" && <HardwareSection L={L} prefs={store.prefs.hardware} canManage={canManage} />}
        {active === "payments" && <PaymentsSection L={L} prefs={store.prefs.payments} canManage={canManage} bankAccounts={bankAccounts ?? []} accountsLoading={Boolean(lazyLoading.payments)} accountsError={lazyError.payments} />}
        {active === "print" && <PrintSection L={L} />}
        {active === "promotions" && promotionsContent}
        {active === "tax" && <TaxSection L={L} prefs={store.prefs.tax} canManage={canManage} />}
        {active === "notifications" && <NotificationsSection L={L} prefs={store.prefs.notifications} canManage={canManage} />}
        {active === "zalo" && <ZaloSection L={L} prefs={store.prefs.zalo} canEdit={canEditAi} />}
        {active === "shopee" && <ShopeeSettingsSection L={L} prefs={store.prefs.shopee} canEdit={canEditAi} />}
        {active === "ai" && (aiUsage ? <AiSection L={L} prefs={store.prefs.ai} canEdit={canEditAi} usage={aiUsage} /> : <LazySectionState L={L} loading={Boolean(lazyLoading.ai)} error={lazyError.ai} />)}
      </div>
    </div>
  );
}

function LazySectionState({ L, loading, error }: { L: boolean; loading: boolean; error?: string }) {
  return (
    <Card title={L ? "Đang tải dữ liệu" : "Loading data"} vi={L ? "Chỉ tải khi mở mục này" : "Loaded only when this section is opened"}>
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        <span>{error ? (L ? "Không tải được dữ liệu. Vui lòng thử lại." : "Could not load data. Please try again.") : (L ? "Đang tải..." : "Loading...")}</span>
      </div>
    </Card>
  );
}

const INDUSTRY_OPTS = [
  ["grocery", "Grocery / Mini-mart", "Tạp hóa / Siêu thị mini"], ["cafe", "Café", "Quán cà phê"],
  ["restaurant", "Restaurant", "Nhà hàng"], ["fashion", "Fashion & Apparel", "Thời trang"],
  ["electronics", "Electronics", "Điện tử / Điện máy"], ["cosmetics", "Cosmetics & Beauty", "Mỹ phẩm"],
  ["books", "Books & Stationery", "Sách & VPP"], ["services", "Service Business", "Dịch vụ"],
  ["petshop", "Pet Shop", "Thú cưng"], ["mobile", "Mobile & Gadgets", "Điện thoại & Phụ kiện"],
  ["construction", "Construction Materials", "Vật liệu xây dựng"],
] as const;
const ROLE_TEXT: Record<string, [string, string]> = {
  owner: ["Owner", "Chủ cửa hàng"], manager: ["Manager", "Quản lý"],
  cashier: ["Cashier", "Thu ngân"], warehouse: ["Stock-keeper", "Thủ kho"],
};
const ROLE_PILL: Record<string, string> = {
  owner: "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
  manager: "bg-in-soft text-in", cashier: "bg-ok-soft text-ok", warehouse: "bg-warn-soft text-warn",
};
const AVATAR_COLORS = ["#0C7B6B", "#1D4ED8", "#B45309", "#6B6F76", "#9CA0A8"];

function StoreSection({ L, locale, store, canManage }: { L: boolean; locale: string; store: StoreSettings; canManage: boolean }) {
  const [form, setForm] = useState(store);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => { setForm((p) => ({ ...p, [k]: v })); setDirty(true); setSaved(false); };
  const industryOpts = INDUSTRY_OPTS.map(([value, en, vi]) => ({ value, label: locale === "vi" ? vi : en }));
  const currencyOpts = [{ value: "VND", label: "VND — Việt Nam Đồng (₫)" }, { value: "USD", label: "USD — US Dollar ($)" }];
  function save() { start(async () => { const res = await updateStoreSettings(form); if (res.ok) { setDirty(false); setSaved(true); } }); }
  return (
    <Card title={L ? "Thông tin cửa hàng" : "Store Profile"} vi={L ? "Store Profile" : "Thông tin cửa hàng"}>
      <div className="p-4.5 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tên cửa hàng" : "Store Name"}</span><input className={FI} value={form.name} disabled={!canManage} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Số điện thoại" : "Phone"}</span><input className={FI} value={form.phone} disabled={!canManage} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <div className="flex flex-col gap-1"><span className={FL}>{L ? "Địa chỉ" : "Address"}</span><input className={FI} value={form.address} disabled={!canManage} onChange={(e) => set("address", e.target.value)} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Mã số thuế" : "Tax ID"}</span><input className={FI} value={form.taxCode} disabled={!canManage} onChange={(e) => set("taxCode", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Ngành" : "Industry"}</span>
            <SearchableSelect options={industryOpts} value={form.industry} onChange={(v) => set("industry", v)} allowClear={false} disabled={!canManage} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tiền tệ" : "Currency"}</span>
            <SearchableSelect options={currencyOpts} value={form.currency} onChange={(v) => set("currency", v)} allowClear={false} disabled={!canManage} />
          </div>
        </div>
        {canManage && (dirty || saved) && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-500 flex-1">{dirty ? (L ? "Có thay đổi chưa lưu" : "Unsaved changes") : (L ? "Đã lưu" : "Saved")}</span>
            <button disabled={!dirty || pending} onClick={save} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{L ? "Lưu" : "Save"}
            </button>
          </div>
        )}
        {!canManage && <p className="text-[11px] text-slate-400 italic">{L ? "Chỉ Chủ/Quản lý mới sửa được." : "Only Owner/Manager can edit."}</p>}
      </div>
    </Card>
  );
}

function StaffRowItem({ s, i, L, canManage }: { s: StaffRow; i: number; L: boolean; canManage: boolean }) {
  const [role, setRole] = useState(s.role);
  const [active, setActive] = useState(s.isActive);
  const [, start] = useTransition();
  const initial = ((s.fullName.trim().split(" ").pop() ?? "?")[0] ?? "?").toUpperCase();
  return (
    <tr className="border-b border-border-soft last:border-0 hover:bg-surface-2">
      <td className="px-3 py-2.5"><div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-extrabold text-white shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{initial}</span>
        <span className="font-bold text-xs">{s.fullName}</span>
      </div></td>
      <td className="px-3 py-2.5">
        {canManage ? (
          <Select
            value={role}
            onChange={(e) => { const r = e.target.value as StaffRole; setRole(r); start(() => { updateStaffRole(s.id, r); }); }}
            size="sm"
            options={STAFF_ROLES.map((r) => ({ value: r, label: L ? ROLE_TEXT[r][1] : ROLE_TEXT[r][0] }))}
            className="text-xs"
          />
        ) : <span className={cn("inline-block px-2 py-0.5 rounded-full text-[9px] font-bold", ROLE_PILL[role] ?? "bg-surface-2 text-slate-500")}>{L ? (ROLE_TEXT[role]?.[1] ?? role) : (ROLE_TEXT[role]?.[0] ?? role)}</span>}
      </td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{s.phone ?? "—"}</td>
      <td className="px-3 py-2.5">
        {canManage
          ? <Toggle checked={active} onChange={(v) => { setActive(v); start(() => { setStaffActive(s.id, v); }); }} aria-label="active" />
          : <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", active ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-400")}>{active ? (L ? "Hoạt động" : "Active") : (L ? "Vô hiệu" : "Inactive")}</span>}
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
      title={L ? "Hiển thị trang bán hàng" : "POS Page Display"}
      vi={L ? "Ẩn/hiện các trường ít dùng trong màn hình POS" : "Show or hide optional controls on the POS screen"}
    >
      <div className="p-4.5 flex flex-col gap-3">
        <CtrlRow
          title={L ? "Hiện phần Công trình" : "Show project fields"}
          desc={L ? "Bật khi cần gắn đơn hàng với công trình/dự án." : "Enable when orders need a project/job reference."}
          checked={form.showProjectFields}
          onChange={canManage ? (v) => set("showProjectFields", v) : undefined}
        />
        <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
      </div>
    </Card>
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
          { id: "list", label: L ? "Danh sách NV" : "Staff List" },
          { id: "perms", label: L ? "Phân quyền" : "Permission Matrix" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "list" && (
        <Card title={L ? "Danh sách nhân viên" : "Staff Members"} vi={L ? "Staff Members — RBAC" : "Nhân viên — phân quyền"}>
          {staff.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{L ? "Chưa có nhân viên." : "No staff yet."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-canvas text-left text-[9px] uppercase tracking-wide text-slate-400 border-b border-border">
                  <th className="px-3 py-2 font-bold">{L ? "Nhân viên" : "Staff"}</th>
                  <th className="px-3 py-2 font-bold">{L ? "Vai trò" : "Role"}</th>
                  <th className="px-3 py-2 font-bold">{L ? "Điện thoại" : "Phone"}</th>
                  <th className="px-3 py-2 font-bold">{L ? "Trạng thái" : "Status"}</th>
                </tr></thead>
                <tbody>{staff.map((s, i) => <StaffRowItem key={s.id} s={s} i={i} L={L} canManage={canManage} />)}</tbody>
              </table>
            </div>
          )}
          {canManage && <div className="px-4 py-2.5 border-t border-border text-[10px] text-slate-400 italic">{L ? "Thêm nhân viên qua mời tài khoản (sắp có)." : "Add staff via account invite (coming soon)."}</div>}
        </Card>
      )}
      {tab === "perms" && (
        <Card title={L ? "Ma trận phân quyền" : "Permission Matrix"} vi={L ? "RBAC" : "Phân quyền theo vai trò (RBAC)"}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-canvas border-b border-border text-[9px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2 text-left font-bold min-w-45">{L ? "Hành động" : "Action"}</th>
                {roles.map((r) => <th key={r} className="px-2 py-2 font-bold text-center">{L ? ROLE_LABELS[r][1] : ROLE_LABELS[r][0]}</th>)}
              </tr></thead>
              <tbody>{PERMS.map((p, i) => (
                <tr key={i} className="border-b border-border-soft last:border-0">
                  <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">{L ? p.vi : p.en}</td>
                  {roles.map((r) => <td key={r} className="px-2 py-2 text-center">{p.roles[r] ? <Check className="w-3.5 h-3.5 text-ok inline" /> : <span className="text-slate-300 dark:text-slate-700">✕</span>}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border-t border-in/20 text-[10px] text-in">
            {L ? "RBAC mặc định — Owner có thể tùy chỉnh từng quyền (bản Enterprise)." : "Default RBAC — Owner can customise individual permissions (Enterprise plan)."}
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
  const lbl = { connected: [L ? "Đã kết nối" : "Connected", "text-ok"], disconnected: [L ? "Mất kết nối" : "Disconnected", "text-er"], unconfigured: [L ? "Chưa cấu hình" : "Not configured", "text-slate-400"] } as const;
  return (
    <>
      <Card title={L ? "Tùy chọn in & ngăn kéo" : "Print & Drawer Options"} vi={L ? "Áp dụng khi in hóa đơn POS" : "Applied when printing POS receipts"}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-col gap-1 max-w-50">
            <span className={FL}>{L ? "Khổ giấy mặc định" : "Default paper size"}</span>
            <SearchableSelect options={PAPER_SIZES.map((s) => ({ value: s, label: s }))} value={form.paperSize} onChange={(v) => set("paperSize", v as typeof form.paperSize)} allowClear={false} disabled={!canManage} />
          </div>
          <CtrlRow title={L ? "In QR hóa đơn điện tử" : "Print e-invoice QR"} desc={L ? "Mã xác thực theo Nghị định 70" : "Decree 70 verification code"} checked={form.printEinvoiceQr} onChange={canManage ? (v) => set("printEinvoiceQr", v) : undefined} />
          <CtrlRow title={L ? "In tự động sau mỗi đơn" : "Auto-print after each order"} checked={form.autoPrint} onChange={canManage ? (v) => set("autoPrint", v) : undefined} />
          <CtrlRow title={L ? "Mở ngăn kéo khi thu tiền mặt" : "Open cash drawer on cash payment"} checked={form.openDrawer} onChange={canManage ? (v) => set("openDrawer", v) : undefined} />
          <div className="flex items-center gap-2"><Link href="/settings/print" className={btnS}><Printer className="w-3 h-3" />{L ? "Mở thiết kế mẫu in →" : "Open template designer →"}</Link></div>
          <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
        </div>
      </Card>
      <Card title={L ? "Thiết bị (xem trước)" : "Devices (preview)"} vi={L ? "Phát hiện thiết bị sẽ có ở bản desktop" : "Device detection ships with the desktop app"}>
        <div className="p-4 flex flex-col gap-2">
          {DEVICES.map((d, i) => (
            <div key={i} className={cn(ROW, "opacity-70")}>
              <span className="w-9 h-9 rounded-[10px] bg-surface-2 grid place-items-center text-lg shrink-0">{d.ico}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate">{d.name}</div>
                <div className="text-[10px] text-slate-500">{(L ? d.vi : d.en)} · {d.detail}</div>
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
    { id: "methods", label: L ? "Phương thức" : "Methods" },
    { id: "accounts", label: L ? "Tài khoản ngân hàng" : "Bank accounts" },
    { id: "notifications", label: L ? "Thông báo thanh toán" : "Payment notifications" },
  ] as const;
  return (
    <>
      <SegmentedTabs className="mb-4" items={tabs} value={tab} onChange={setTab} />
      {tab === "methods" && (
        <Card title={L ? "Phương thức thanh toán" : "Payment Methods"} vi={L ? "Bật phương thức cho màn thanh toán" : "Enable methods for checkout"}>
          <div className="p-4 flex flex-col gap-2">
            {PAYMENTS.map((p) => {
              const id = p.id as keyof typeof pm;
              return (
                <div key={p.id} className={ROW}>
                  <span className="w-9 h-9 rounded-[10px] grid place-items-center text-lg shrink-0" style={{ background: p.color + "22", border: `1px solid ${p.color}33` }}>{p.ico}</span>
                  <div className="flex-1 min-w-0"><div className="text-xs font-bold">{L ? p.vi : p.name}</div><div className="text-[10px] text-slate-500">{p.note}</div></div>
                  <Toggle checked={pm[id]} onChange={() => toggle(id)} aria-label={p.name} />
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
    <Card title={t("notificationTitle")} vi={L ? "Webhook SePay để tự xác nhận tiền vào" : "SePay webhook for automatic payment confirmation"}>
      <div className="p-4 flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-canvas p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold">{t("setupTitle")}</div>
            </div>
            <a href="https://my.sepay.vn" target="_blank" rel="noreferrer" className={cn(btnS, "h-9 shrink-0 justify-center rounded-lg px-3 whitespace-nowrap")}>
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
  const remove = (account: PaymentBankAccountRow) => {
    const ok = window.confirm(t("deleteConfirm", { account: account.accountNumber }));
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
    <Card title={t("title")} vi={L ? "Chỉ cần tài khoản ngân hàng để tạo VietQR" : "Only a bank account is required to generate VietQR"}>
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
            <div key={account.id} className={cn(ROW, "items-start")}>
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
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => edit(account)} className={btnS} aria-label={t("edit")}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={account.isDefault || pending} onClick={() => makeDefault(account.id)} className={btnS} aria-label={t("setDefault")}>
                    <Star className="w-3.5 h-3.5" />
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
                <div className="mt-0.5 text-[11px] text-slate-500">{L ? "Tài khoản dùng để tạo VietQR và nhận callback SePay." : "Use this account for VietQR and SePay callbacks."}</div>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={pending}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 disabled:opacity-50"
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
    <div ref={ref} className="relative">
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
        <div className="mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
          <div className="border-b border-border-soft">
            <input
              autoFocus
              className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
              value={q}
              onChange={(event) => setQ(event.target.value)}
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
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2",
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
      title: L ? "Mẫu chứng từ" : "Document templates",
      desc: L ? "Hóa đơn, báo giá, đặt hàng, nhập hàng, trả hàng và biên nhận." : "Invoices, quotes, bookings, purchases, returns and receipts.",
      meta: "A4 / A5 / K80",
      primary: true,
    },
    {
      href: Routes.LabelSettings,
      title: L ? "Mẫu tem mã" : "Barcode label templates",
      desc: L ? "Tem mã vạch sản phẩm, SKU, giá bán, lề trắng và kích thước tem." : "Product barcode labels, SKU, price, quiet zones and label sizes.",
      meta: "40x30 / 50x30 / 35x22",
      primary: false,
    },
  ];
  return (
    <Card title={L ? "Thiết kế mẫu in (15.1)" : "Print Template Designer (15.1)"} vi={L ? "Chứng từ · tem mã · K80/K57/A5/A4" : "Documents · barcode labels · K80/K57/A5/A4"}>
      <div className="p-4.5">
        <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
          {L ? "Tùy chỉnh mẫu in theo từng nhóm để tránh nhầm giữa chứng từ và tem mã vạch sản phẩm." : "Manage each print-template group separately so document layouts and product barcode labels stay clear."}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group rounded-[10px] border p-4 transition hover:-translate-y-0.5 hover:shadow-e1",
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
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((p) => ({ ...p, [k]: v })); setDirty(true); setSaved(false); };
  function save() { start(async () => { const r = await updateStorePrefs({ tax: form }); if (r.ok) { setDirty(false); setSaved(true); } }); }
  const providerOpts = ["VNPT e-Invoice", "Viettel-S", "MISA meInvoice", "FPT Invoice", "Bkav eHóa đơn", "CyberLotus", "EasyInvoice"].map((p) => ({ value: p.split(" ")[0], label: p }));
  const pctColor = (r: number) => r === 0 ? "text-slate-400" : r === 5 ? "text-ok" : r === 8 ? "text-warn" : "text-er";
  return (
    <>
      <Card title={L ? "Thuế GTGT — Thuế suất mặc định" : "VAT — Default rate"} vi={L ? "Áp khi tạo đơn / phiếu nhập" : "Applied on new orders / purchases"}>
        <div className="p-3.5 flex flex-col gap-1.5">
          {VAT_RATES.map((v) => {
            const on = v.rate === form.defaultRate;
            return (
              <button key={v.rate} type="button" disabled={!canManage} onClick={() => set("defaultRate", v.rate)} className={cn(ROW, "text-left transition", on && "border-primary-500 ring-2 ring-primary-500/20", canManage && "hover:border-primary-400")}>
                <span className={cn("font-mono text-base font-extrabold w-10 shrink-0", pctColor(v.rate))}>{v.rate}%</span>
                <div className="flex-1 min-w-0"><div className="text-xs font-bold">{L ? v.vi : v.en}</div><div className="text-[10px] text-slate-500">{L ? v.itemsVi : v.itemsEn}</div></div>
                {on && <span className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 shrink-0">{L ? "Mặc định" : "Default"}</span>}
              </button>
            );
          })}
          <CtrlRow title={L ? "Giá đã bao gồm thuế" : "Prices include tax"} desc={L ? "Giá niêm yết đã gồm GTGT" : "Listed prices are tax-inclusive"} checked={form.priceIncludesTax} onChange={canManage ? (v) => set("priceIncludesTax", v) : undefined} />
        </div>
      </Card>
      <Card title={L ? "Hóa đơn điện tử (Nghị định 70/2025)" : "E-Invoice — Decree 70/2025"} vi={L ? "Cấu hình nhà cung cấp HĐĐT" : "E-invoice provider config"} action={<Toggle checked={form.einvoiceEnabled} onChange={canManage ? (v) => set("einvoiceEnabled", v) : () => {}} aria-label="einvoice" />}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Mã số thuế (MST)" : "Tax ID (MST)"}</span><input className={cn(FI, "font-mono")} value={form.einvoiceTaxId} disabled={!canManage} placeholder="0123456789" onChange={(e) => set("einvoiceTaxId", e.target.value)} /></div>
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Nhà cung cấp HĐĐT" : "E-Invoice Provider"}</span>
              <SearchableSelect options={providerOpts} value={form.einvoiceProvider} onChange={(v) => set("einvoiceProvider", v)} allowClear={false} disabled={!canManage} />
            </div>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            <strong>Circular 32/2025:</strong> {L ? "Mã xác thực cơ quan thuế bắt buộc trên mọi hóa đơn từ 01/07/2025." : "Tax-authority verification code mandatory on all invoices from 01/07/2025."}
          </div>
        </div>
      </Card>
      <SaveBar L={L} dirty={dirty} saved={saved} pending={pending} canManage={canManage} onSave={save} />
    </>
  );
}

function NotificationsSection({ L, prefs, canManage }: { L: boolean; prefs: StorePrefs["notifications"]; canManage: boolean }) {
  const [form, setForm] = useState(prefs);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const mark = () => { setDirty(true); setSaved(false); };
  type TK = "lowStock" | "stagnant" | "shiftClose" | "einvoiceError" | "syncDone";
  type CK = "zalo" | "email" | "inApp" | "sms";
  const setType = (k: TK, v: boolean) => { setForm((p) => ({ ...p, [k]: v })); mark(); };
  const setChannel = (k: CK, v: boolean) => { setForm((p) => ({ ...p, channels: { ...p.channels, [k]: v } })); mark(); };
  function save() { start(async () => { const r = await updateStorePrefs({ notifications: form }); if (r.ok) { setDirty(false); setSaved(true); } }); }

  const types: { k: TK; title: string; desc: string }[] = [
    { k: "lowStock", title: L ? "Cảnh báo tồn kho thấp" : "Low-stock alert", desc: L ? "Khi tồn < mức tối thiểu" : "When stock < minimum" },
    { k: "stagnant", title: L ? "Hàng chậm bán (>60 ngày)" : "Stagnant stock (>60 days)", desc: L ? "SKU không bán 60 ngày" : "SKU unsold 60+ days" },
    { k: "shiftClose", title: L ? "Nhắc đóng ca (18:00)" : "Shift close reminder (18:00)", desc: L ? "Nhắc đóng ca mỗi ngày" : "Daily shift close reminder" },
    { k: "einvoiceError", title: L ? "Lỗi hóa đơn điện tử" : "E-invoice error", desc: L ? "Khi HĐĐT gửi thất bại" : "When e-invoice fails" },
    { k: "syncDone", title: L ? "Đồng bộ hoàn tất" : "Sync completed", desc: L ? "Khi dữ liệu offline đồng bộ xong" : "When offline data syncs" },
  ];
  const channels: { k: CK; ico: string; name: string }[] = [
    { k: "zalo", ico: "📱", name: "Zalo OA" }, { k: "email", ico: "📧", name: "Email" },
    { k: "inApp", ico: "🔔", name: L ? "Thông báo trong ứng dụng" : "In-app push" }, { k: "sms", ico: "💬", name: "SMS" },
  ];
  return (
    <>
      <Card title={L ? "Loại thông báo" : "Notification Types"} vi={L ? "Ngưỡng & sự kiện" : "Thresholds & events"}>
        <div className="p-4.5 flex flex-col gap-1.5">
          {types.map((tp) => <CtrlRow key={tp.k} title={tp.title} desc={tp.desc} checked={form[tp.k]} onChange={canManage ? (v) => setType(tp.k, v) : undefined} />)}
        </div>
      </Card>
      <Card title={L ? "Kênh thông báo" : "Notification Channels"} vi={L ? "Nơi gửi thông báo" : "Where alerts are sent"}>
        <div className="p-3.5 flex flex-col gap-1.5">
          {channels.map((c) => (
            <div key={c.k} className={ROW}>
              <span className="text-lg">{c.ico}</span>
              <div className="flex-1 text-xs font-bold">{c.name}</div>
              <Toggle checked={form.channels[c.k]} onChange={canManage ? (v) => setChannel(c.k, v) : () => {}} aria-label={c.name} />
            </div>
          ))}
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
        placeholder={setFlag ? (L ? "Để trống để giữ giá trị hiện tại" : "Leave blank to keep current value") : ""}
        onChange={(e) => onValueChange(id, e.target.value)}
      />
      <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        <input type="checkbox" checked={clear} disabled={!canEdit} onChange={(e) => onClearChange(id, e.target.checked)} />
        {L ? "Xóa giá trị đang lưu" : "Clear saved value"}
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
    partnerId: prefs.partnerId,
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
      <Card title={L ? "Marketplace Developer Apps" : "Marketplace Developer Apps"} vi={L ? "Cấu hình kỹ thuật cho OAuth và API sàn" : "Technical OAuth and marketplace API setup"}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold",
              form.enabled ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500"
            )}>
              {form.enabled ? (L ? "Đang bật" : "Enabled") : (L ? "Đang tắt" : "Disabled")}
            </span>
            <Link href={Routes.OnlineSales} className={btnS}>{L ? "Mở Bán online" : "Open Online Sales"}</Link>
            <a href="https://open.shopee.com/" target="_blank" rel="noreferrer" className={btnS}>
              <ExternalLink className="w-3 h-3" /> {L ? "Đăng ký Shopee app" : "Register Shopee app"}
            </a>
          </div>
          <CtrlRow
            title={L ? "Bật provider Shopee" : "Enable Shopee provider"}
            desc={L ? "Bật app credential để Online Sales có thể kết nối gian hàng Shopee." : "Enable app credentials so Online Sales can connect Shopee shops."}
            checked={form.enabled}
            onChange={(value) => set("enabled", value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Môi trường" : "Environment"}</span>
              <Select
                value={form.environment}
                onChange={(e) => set("environment", e.target.value === "production" ? "production" : "sandbox")}
                options={[{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Production" }]}
                disabled={!canEdit}
                className={FI}
              />
            </div>
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Vùng" : "Region"}</span><input className={FI} name="marketplace-region" autoComplete="off" value={form.region} disabled={!canEdit} onChange={(e) => set("region", e.target.value.toUpperCase())} /></div>
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
                placeholder={partnerKeySet ? (L ? "Đã lưu, nhập key mới để thay" : "Saved, enter a new key to replace") : (L ? "Chưa cấu hình" : "Not configured")}
                onChange={(e) => set("partnerKey", e.target.value)}
              />
              <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <input type="checkbox" checked={clearPartnerKey} disabled={!canEdit} onChange={(e) => { setClearPartnerKey(e.target.checked); mark(); }} />
                {L ? "Xóa partner key đang lưu" : "Clear saved partner key"}
              </label>
            </div>
            <div className="flex flex-col gap-1"><span className={FL}>OAuth callback</span><input className={cn(FI, "font-mono")} name="shopee-oauth-callback" autoComplete="off" value={form.redirectPath} disabled={!canEdit} onChange={(e) => set("redirectPath", e.target.value)} /><span className="text-[11px] text-slate-500 break-all">{callbackUrl}</span></div>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {L
              ? "Đây là cấu hình kỹ thuật cho owner/developer. Nhân viên bán hàng nên kết nối gian hàng, chọn kho và chính sách đồng bộ trong Bán online. AI chỉ tạo gợi ý listing, không tự publish."
              : "This is owner/developer setup. Sales staff should connect shops, choose warehouses, and configure sync policy in Online Sales. AI only drafts listings and never auto-publishes."}
          </div>
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{L ? "Chỉ owner được sửa cấu hình developer sàn." : "Only the owner can edit marketplace developer settings."}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (L ? "Có thay đổi chưa lưu" : "Unsaved changes") : (L ? "Đã lưu" : "Saved"))}</span>
          <button disabled={!dirty || pending} onClick={save} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{L ? "Lưu" : "Save"}
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
        title={L ? "Zalo Official Account" : "Zalo Official Account"}
        vi={L ? "OA token và trạng thái gửi ZNS" : "OA token and ZNS sending status"}
        action={<Toggle checked={form.enabled} onChange={canEdit ? (v) => set("enabled", v) : () => {}} aria-label="zalo" />}
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
                  ? (L ? "Sẵn sàng gửi ZNS" : "Ready for ZNS")
                  : (L ? "Sẵn sàng gửi tin OA" : "Ready for OA messages")
                : connected
                  ? (L ? "Thiếu template ZNS" : "ZNS template missing")
                  : (L ? "Chưa đủ cấu hình" : "Configuration incomplete")}
            </span>
            {isZnsMode && connected && !znsReady && (
              <span className="text-[11px] font-semibold text-slate-500">
                {L ? "Template ZNS cần để gửi bằng SĐT." : "ZNS templates are required for phone delivery."}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Kênh gửi mặc định" : "Default sending channel"}</span>
              <Select
                className="w-full"
                disabled={!canEdit}
                value={form.deliveryMode}
                options={[
                  { value: "oa", label: L ? "Tin nhắn OA (Zalo user ID)" : "OA message (Zalo user ID)" },
                  { value: "zns", label: L ? "ZNS Template (SĐT)" : "ZNS Template (phone)" },
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
              <div className="flex flex-col gap-1"><span className={FL}>{L ? "Template link đặt hàng" : "Portal link template"}</span><input className={cn(FI, "font-mono")} value={form.portalTemplateId} disabled={!canEdit} onChange={(e) => set("portalTemplateId", e.target.value)} /></div>
              <div className="flex flex-col gap-1"><span className={FL}>{L ? "Template hóa đơn" : "Invoice template"}</span><input className={cn(FI, "font-mono")} value={form.invoiceTemplateId} disabled={!canEdit} onChange={(e) => set("invoiceTemplateId", e.target.value)} /></div>
              <div className="flex flex-col gap-1"><span className={FL}>{L ? "Template công nợ" : "Debt template"}</span><input className={cn(FI, "font-mono")} value={form.debtTemplateId} disabled={!canEdit} onChange={(e) => set("debtTemplateId", e.target.value)} /></div>
            </div>
          )}
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {L
              ? "Token và secret chỉ lưu server-side trong Settings. Mobile/web chỉ gọi backend LumaPOS; tin giao dịch cần template ZNS đã được Zalo duyệt."
              : "Tokens and secrets are stored server-side in Settings only. Web/mobile call the LumaPOS backend; transactional messages require approved ZNS templates."}
          </div>
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{L ? "Chỉ owner được sửa cấu hình Zalo." : "Only the owner can edit Zalo settings."}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (L ? "Có thay đổi chưa lưu" : "Unsaved changes") : (L ? "Đã lưu" : "Saved"))}</span>
          <button disabled={!dirty || pending} onClick={save} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{L ? "Lưu" : "Save"}
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
    attachmentsBucket: AiAttachmentBucket;
    monthlyUsageLimit: number;
    showFloatingLauncher: boolean;
  }>({
    provider: coerceAiProvider(prefs.provider),
    textModel: coerceAiTextModel(prefs.textModel),
    visionModel: coerceAiVisionModel(prefs.visionModel || prefs.openaiVisionModel),
    openaiApiKey: "",
    openaiVisionModel: coerceAiVisionModel(prefs.visionModel || prefs.openaiVisionModel),
    attachmentsBucket: coerceAiAttachmentBucket(prefs.attachmentsBucket),
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
  const diagnosticsRows: Array<[string, string, boolean]> = [
    [L ? "Provider" : "Provider", AI_PROVIDER_OPTIONS.find((item) => item.value === form.provider)?.label ?? form.provider, true],
    [L ? "Text model" : "Text model", form.textModel, true],
    [L ? "Vision model" : "Vision model", form.visionModel, form.provider !== "deepseek"],
    [L ? "API key" : "API key", configured ? (L ? "Đã cấu hình" : "Configured") : (L ? "Chưa có" : "Missing"), configured],
    [L ? "Text planning" : "Text planning", L ? "Hỗ trợ" : "Supported", true],
    [L ? "Vision/OCR" : "Vision/OCR", form.provider === "deepseek" ? (L ? "Không hỗ trợ" : "Unsupported") : (L ? "Hỗ trợ" : "Supported"), form.provider !== "deepseek"],
  ];
  return (
    <>
      <Card title={L ? "Nhà cung cấp AI" : "AI Provider"} vi={L ? "OCR và lập kế hoạch cho trợ lý AI" : "OCR and planning for AI Assistant"}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold",
              configured ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
            )}>
              {configured ? (L ? "Đã cấu hình API key" : "API key configured") : (L ? "Chưa có API key" : "API key missing")}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Provider" : "Provider"}</span>
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
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "API key của provider" : "Provider API key"}</span>
              <input
                className={cn(FI, "font-mono")}
                type="password"
                value={form.openaiApiKey}
                disabled={!canEdit || clearOpenaiApiKey}
                placeholder={providerKeyPlaceholder(form.provider, openaiApiKeySet, L)}
                onChange={(e) => set("openaiApiKey", e.target.value)}
              />
              <span className="text-[11px] text-slate-500">{providerKeyHelp(form.provider, L)}</span>
              <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <input type="checkbox" checked={clearOpenaiApiKey} disabled={!canEdit} onChange={(e) => toggleClearKey(e.target.checked)} />
                {L ? "Xóa API key đang lưu" : "Clear saved API key"}
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Model lập kế hoạch" : "Planner model"}</span>
              <SearchableSelect
                options={AI_TEXT_MODEL_OPTIONS}
                value={form.textModel}
                onChange={(value) => set("textModel", coerceAiTextModel(value))}
                allowClear={false}
                showSearch={false}
                disabled={!canEdit}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Model OCR/ảnh" : "OCR/image model"}</span>
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
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Bucket lưu file đính kèm" : "Attachment bucket"}</span>
              <SearchableSelect
                options={AI_BUCKET_OPTIONS}
                value={form.attachmentsBucket}
                onChange={(value) => set("attachmentsBucket", coerceAiAttachmentBucket(value))}
                allowClear={false}
                showSearch={false}
                disabled={!canEdit}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={FL}>{L ? "Giới hạn lượt AI/tháng" : "Monthly AI unit limit"}</span>
              <input
                className={cn(FI, "font-mono")}
                type="number"
                min={0}
                max={100000}
                step={1}
                value={form.monthlyUsageLimit}
                disabled={!canEdit}
                onChange={(e) => set("monthlyUsageLimit", Math.max(0, Math.min(100000, Math.trunc(Number(e.target.value) || 0))))}
              />
            </div>
          </div>
          <CtrlRow
            title={L ? "Hiện nút AI nổi" : "Show floating AI button"}
            desc={L ? "Tắt để ẩn nút AI nổi góc màn hình; trang AI và cấu hình provider vẫn giữ nguyên." : "Turn off to hide the floating AI button; the AI page and provider settings remain available."}
            checked={form.showFloatingLauncher}
            onChange={(value) => set("showFloatingLauncher", value)}
          />
          <div className="grid grid-cols-3 gap-2">
            {[
              [L ? "Lượt đã dùng" : "Units used", usage.used],
              [L ? "Lượt còn lại" : "Units remaining", displayRemaining],
              [L ? "Giới hạn lượt/tháng" : "Monthly unit limit", displayLimit],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[10px] border border-border bg-canvas px-3 py-2">
                <div className={FL}>{label}</div>
                <div className={cn("mt-1 font-mono text-base font-extrabold", label === (L ? "Lượt còn lại" : "Units remaining") && displayExhausted ? "text-er" : "text-slate-800 dark:text-slate-100")}>{Number(value).toLocaleString("vi-VN")}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {[
              [L ? "Input tokens" : "Input tokens", usage.inputTokens.toLocaleString("vi-VN")],
              [L ? "Output tokens" : "Output tokens", usage.outputTokens.toLocaleString("vi-VN")],
              [L ? "Tổng tokens" : "Total tokens", usage.totalTokens.toLocaleString("vi-VN")],
              [L ? "Chi phí ước tính" : "Estimated cost", `$${usage.estimatedCostUsd.toFixed(4)}`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[10px] border border-border bg-canvas px-3 py-2">
                <div className={FL}>{label}</div>
                <div className="mt-1 font-mono text-sm font-extrabold text-slate-800 dark:text-slate-100">{value}</div>
              </div>
            ))}
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            {L
              ? `API key không hiển thị lại sau khi lưu, chỉ được dùng server-side từ Settings và không được ghi raw vào audit log. Usage được tính theo tháng ${usage.period}; mỗi lần hỏi AI tốn 1 lượt, mỗi file đính kèm được xử lý (tối đa 4 file/lần) tốn thêm 1 lượt. Giới hạn/còn lại hiển thị theo giá trị đang nhập${limitPreviewChanged ? ", có hiệu lực sau khi lưu" : ""}. Token/chi phí là ước tính từ provider/model trả về, không phải hóa đơn chính thức.`
              : `The API key is never shown again after saving, is used server-side from Settings only, and is not written raw into audit logs. Usage is tracked for ${usage.period}; each AI request costs 1 unit, and each processed attachment (up to 4 files per request) adds 1 unit. Limit/remaining values follow the current input${limitPreviewChanged ? " and take effect after saving" : ""}. Token/cost totals are provider/model estimates, not official billing.`}
          </div>
        </div>
      </Card>
      <Card title={L ? "Chẩn đoán provider" : "Provider diagnostics"} vi={L ? "Kiểm tra key, model text và OCR/ảnh" : "Test key, text model and vision/OCR"}>
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {testing === "text" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {L ? "Test text model" : "Test text model"}
            </button>
            <button
              type="button"
              disabled={!canEdit || testing !== null || form.provider === "deepseek"}
              onClick={() => void runProviderTest("vision")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
            >
              {testing === "vision" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {L ? "Test vision model" : "Test vision model"}
            </button>
          </div>
          {testResult && (
            <div className={cn(
              "rounded-[10px] border px-3.5 py-2.5 text-[11px] leading-relaxed",
              testResult.ok ? "border-ok/20 bg-ok-soft text-ok" : "border-warn/20 bg-warn-soft text-warn"
            )}>
              <div className="font-bold">
                {testResult.kind === "text" ? "Text" : "Vision"} · {testResult.ok ? (L ? "Kết nối OK" : "Connection OK") : (L ? "Cần kiểm tra lại" : "Needs attention")}
              </div>
              <div className="mt-1">
                {L ? "Kết quả" : "Result"}: {formatAiTestMessage(testResult.message, L)}
                {testResult.tokenUsage ? ` · tokens ${testResult.tokenUsage.totalTokens}` : ""}
              </div>
              <div className="mt-1 text-[10px] opacity-75">{new Date(testResult.testedAt).toLocaleString("vi-VN")}</div>
            </div>
          )}
          {testError && <div className="rounded-[10px] border border-er/20 bg-er-soft px-3.5 py-2.5 text-[11px] font-semibold text-er">{testError}</div>}
        </div>
      </Card>
      {!canEdit && <p className="text-[11px] text-slate-400 italic mt-1">{L ? "Chỉ owner được sửa cấu hình AI." : "Only the owner can edit AI settings."}</p>}
      {canEdit && (dirty || saved || error) && (
        <div className="flex items-center gap-2 pt-1">
          <span className={cn("text-[11px] flex-1", error ? "text-er" : "text-slate-500")}>{error || (dirty ? (L ? "Có thay đổi chưa lưu" : "Unsaved changes") : (L ? "Đã lưu" : "Saved"))}</span>
          <button disabled={!dirty || pending} onClick={save} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{L ? "Lưu" : "Save"}
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
      <Toggle checked={checked} onChange={onChange ?? (() => {})} aria-label={title} />
    </div>
  );
}

function SaveBar({ L, dirty, saved, pending, canManage, onSave }: { L: boolean; dirty: boolean; saved: boolean; pending: boolean; canManage: boolean; onSave: () => void }) {
  if (!canManage) return <p className="text-[11px] text-slate-400 italic mt-1">{L ? "Chỉ Chủ/Quản lý mới sửa được." : "Only Owner/Manager can edit."}</p>;
  if (!dirty && !saved) return null;
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] text-slate-500 flex-1">{dirty ? (L ? "Có thay đổi chưa lưu" : "Unsaved changes") : (L ? "Đã lưu" : "Saved")}</span>
      <button disabled={!dirty || pending} onClick={onSave} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{L ? "Lưu" : "Save"}
      </button>
    </div>
  );
}
