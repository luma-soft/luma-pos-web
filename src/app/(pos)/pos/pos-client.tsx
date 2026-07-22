"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, Plus, Minus, Trash2, Loader2, ShoppingCart, X, GripVertical, WifiOff, RefreshCw, ChevronDown, Printer, MoreVertical, CheckCircle2, FileText, ClipboardList, UserPlus, RotateCcw } from "lucide-react";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/normalize";
import { createPortal } from "react-dom";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { PrintDoc } from "@/components/print/print-doc";
import { AiQuickActionButton } from "@/components/ai-quick-actions/ai-quick-action-button";
import { AiQuickActionModal } from "@/components/ai-quick-actions/ai-quick-action-modal";
import { CustomerCreateDialog, type CustomerCreateResult } from "@/components/partners/customer-create-dialog";
import { CameraQuotePanel, type CameraQuotePackage } from "@/components/pos/camera-quote-panel";
import type { PaperSize, PrintTemplate } from "@/lib/print/template-shared";
import type { StorePrefs } from "@/lib/schemas/settings";
import type { AiActionPreview } from "@/lib/ai/actions";
import { createOrder } from "@/lib/actions/orders";
import { createPosReturn, searchReturnableOrders, type ReturnableOrderOption } from "@/lib/actions/returns";
import { searchPosProducts } from "@/lib/actions/pos-search";
import { saveCatalog, enqueueOrder, getOutbox, removeOutbox, markFailed } from "@/lib/offline/pos-store";
import { applyPromo } from "@/lib/promo";
import { categoryEmoji } from "@/lib/category-emoji";
import { Routes } from "@/lib/routes";
import type { PosData, PosProduct, PosUnit } from "@/lib/data/pos";

type CartLine = {
  key: string;
  product: PosProduct;
  unitName: string;
  unitMultiplier: number;
  unitPrice: number;      // đơn giá niêm yết của đơn vị đang chọn
  quantity: number;
  returnSoldQuantity?: number;
  lineDiscount?: number;  // giảm giá tay (VND) trên mỗi đơn vị
  manualPrice?: boolean;  // đã sửa giá/giảm giá tay → bỏ qua KM tự động
  note?: string;
};

type PosAiCartDraftItem = {
  productId?: string;
  productName?: string;
  sku?: string;
  text?: string;
  unitName?: string;
  quantity?: number;
  confidence?: number;
  reason?: string;
};

type PosAiUnresolvedItem = {
  key: string;
  label: string;
  sku?: string;
  quantity: number;
  reason: string;
};

type PosAiCartDraftPayload = {
  previewId?: string;
  intent?: string;
  items?: unknown[];
  payload?: Record<string, unknown>;
  createdAt?: number;
};

type PayMethod = "cash" | "bank_transfer" | "credit";
type PosDraftKind = "invoice" | "quote" | "booking" | "return_quick" | "return_invoice";
type PosPrintPaymentQr = {
  title: string;
  qrImageUrl: string;
  bankLabel: string;
  accountLabel: string;
  nameLabel: string;
  referenceLabel: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  reference: string;
};
type PosPrintJob = {
  template: PrintTemplate;
  title: string;
  code: string;
  date: string;
  partyName: string;
  partyPhone?: string | null;
  projectName?: string | null;
  items: CartLine[];
  totals: { subtotal: number; discount: number; tax: number; shipping: number };
  grandTotal: number;
  paid: number;
  remaining: number;
  payMethod: PayMethod;
  paymentQr?: PosPrintPaymentQr | null;
};
type SepayCheckout = {
  paymentId: string;
  orderId: string;
  orderCode: string;
  reference: string;
  amount: number;
  qrImageUrl: string;
  status: string;
  bankAccount: {
    bankCode: string;
    gateway: string | null;
    accountNumber: string;
    subAccount: string | null;
    accountName: string;
  };
  printJob: PosPrintJob;
};
type PosCustomer = PosData["customers"][number];
export type PosSourceInvoice = {
  id?: string;
  mode: "edit" | "copy" | "return";
  kind: PosDraftKind;
  code: string;
  saleTime?: string;
  customerId?: string;
  projectId?: string;
  projectName?: string;
  note?: string;
  discount?: number;
  shippingFee?: number;
  tax?: number;
  subtotal?: number;
  items?: Array<{
    productId: string;
    unitName: string;
    quantity: number;
    unitPrice: number;
    lineDiscount?: number;
    note?: string;
  }>;
};

export type PosInitialContext = {
  kind: "quote" | "return_quick";
  customerId?: string;
  projectId: string;
  projectName: string;
  cameraQuote?: boolean;
  cameraId?: string;
};

/**
 * Một hóa đơn đang soạn (tab). Cho phép mở nhiều đơn cùng lúc — bán cho nhiều
 * khách song song mà không mất giỏ (giống KiotViet/Sapo). Lưu localStorage.
 */
/** Bảng giá áp cho hóa đơn = id bảng giá ("" = bảng giá mặc định/giá lẻ). */
export type PriceBook = string;

interface PosDraft {
  id: string;
  kind: PosDraftKind;
  cameraQuote?: boolean;
  cameraInitialId?: string;
  cameraPackages?: CameraQuotePackage[];
  source?: PosSourceInvoice;
  cart: CartLine[];
  customerId: string;
  projectId: string;
  projectName: string;
  deliveryDate?: string;
  priceBook: PriceBook;
  discountInput: number;
  discountMode: "vnd" | "pct";
  taxRate: number;
  shippingFee: number;
  payMethod: PayMethod;
  paidInput: number | null;
  note?: string;
  returnOrderId?: string;
  returnOrderCode?: string;
  returnReason?: string;
  returnRestock?: boolean;
}

const INV_KEY = "pos-invoices";
const ACT_KEY = "pos-active-invoice";
const PRINT_SIZE_KEY = "pos-print-default-size";
const AI_POS_DRAFT_KEY = "luma-pos-ai-cart-draft";
const FIRST_INV_ID = "inv-1"; // id ổn định cho SSR (tránh hydration mismatch)
const SOURCE_INV_ID = "inv-source";

/** Đơn rỗng. id truyền vào để lần đầu dùng id cố định, các tab sau dùng Date.now. */
function makeDraft(id?: string, kind: PosDraftKind = "invoice"): PosDraft {
  return {
    id: id ?? `inv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    kind,
    cart: [], customerId: "", projectId: "", projectName: "", priceBook: "",
    discountInput: 0, discountMode: "vnd", taxRate: 0,
    shippingFee: 0, payMethod: "cash", paidInput: null,
    returnReason: "other", returnRestock: true,
  };
}

function makeInvoice(id?: string): PosDraft {
  return makeDraft(id, "invoice");
}

function makeDraftFromContext(context: PosInitialContext, id = SOURCE_INV_ID): PosDraft {
  return {
    ...makeDraft(id, context.kind),
    cameraQuote: context.cameraQuote,
    cameraInitialId: context.cameraId,
    customerId: context.customerId ?? "",
    projectId: context.projectId,
    projectName: context.projectName,
  };
}

function makeDraftFromSource(source: PosSourceInvoice, products: PosProduct[], id = FIRST_INV_ID): PosDraft {
  const afterDiscount = Math.max(0, (source.subtotal ?? 0) - (source.discount ?? 0));
  const taxRate = afterDiscount > 0 && source.tax ? Math.round(((source.tax / afterDiscount) * 100) * 100) / 100 : 0;
  if (source.mode === "return") {
    return {
      ...makeDraft(id, "return_invoice"),
      source,
      cart: (source.items ?? []).flatMap((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) return [];
        const unit = item.unitName === product.baseUnit ? null : product.units.find((u) => u.unitName === item.unitName) ?? null;
        return [{
          key: `${item.productId}-${item.unitName}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          product,
          unitName: item.unitName,
          unitMultiplier: unit ? Number(unit.multiplier) : 1,
          unitPrice: Math.max(0, item.unitPrice),
          quantity: 0,
          returnSoldQuantity: item.quantity,
          lineDiscount: Math.max(0, item.lineDiscount ?? 0),
          manualPrice: true,
          note: item.note || undefined,
        }];
      }),
      returnOrderId: source.id,
      returnOrderCode: source.code,
      customerId: source.customerId ?? "",
      projectId: source.projectId ?? "",
      projectName: source.projectName ?? "",
    };
  }
  return {
    ...makeDraft(id, source.kind),
    source,
    cart: (source.items ?? []).flatMap((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return [];
      const unit = item.unitName === product.baseUnit ? null : product.units.find((u) => u.unitName === item.unitName) ?? null;
      return [{
        key: `${item.productId}-${item.unitName}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        product,
        unitName: item.unitName,
        unitMultiplier: unit ? Number(unit.multiplier) : 1,
        unitPrice: Math.max(0, item.unitPrice),
        quantity: item.quantity,
        lineDiscount: Math.max(0, item.lineDiscount ?? 0),
        manualPrice: true,
        note: item.note || undefined,
      }];
    }),
    customerId: source.customerId ?? "",
    projectId: source.projectId ?? "",
    projectName: source.projectName ?? "",
    discountInput: source.discount ?? 0,
    discountMode: "vnd",
    taxRate,
    shippingFee: source.shippingFee ?? 0,
    note: source.note || undefined,
  };
}

function draftKind(raw: unknown): PosDraftKind {
  return raw === "quote" || raw === "booking" || raw === "return_quick" || raw === "return_invoice" ? raw : "invoice";
}

function normalizeInvoice(raw: Record<string, unknown>): PosDraft {
  const base = makeDraft(raw.id as string | undefined, draftKind(raw.kind));
  return {
    ...base,
    ...(raw as Partial<PosDraft>),
    discountInput: (raw.discountInput as number | undefined) ?? (raw.discount as number | undefined) ?? 0,
    discountMode: (raw.discountMode as "vnd" | "pct" | undefined) ?? "vnd",
    taxRate: (raw.taxRate as number | undefined) ?? 0,
  };
}

function ensureInvoiceFirst(list: PosDraft[]) {
  if ((list[0]?.kind ?? "invoice") === "invoice") return list;
  return [makeInvoice(FIRST_INV_ID), ...list.filter((draft) => draft.id !== FIRST_INV_ID)];
}

function isReturnKind(kind: PosDraftKind) {
  return kind === "return_quick" || kind === "return_invoice";
}

function loadInvoices(): PosDraft[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(INV_KEY) ?? "null") as Record<string, unknown>[] | null;
    if (!raw || raw.length === 0) return null;
    return ensureInvoiceFirst(raw.map(normalizeInvoice));
  } catch {
    return null;
  }
}

function saveInvoices(list: PosDraft[]) {
  try {
    localStorage.setItem(INV_KEY, JSON.stringify(list));
  } catch { /* đầy quota — bỏ qua */ }
}

function pendingAiCartItem(raw: unknown, index: number): PosAiUnresolvedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as PosAiCartDraftItem;
  const label = (item.productName ?? item.text ?? item.sku ?? `Dòng ${index + 1}`).trim();
  if (!label) return null;
  return {
    key: `ai-unresolved-${index}-${item.sku ?? label}`,
    label,
    sku: item.sku?.trim() || undefined,
    quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
    reason: item.reason === "inactive_or_not_found" ? "Sản phẩm không active hoặc không có trong danh mục" : "Không tìm thấy sản phẩm active trong danh mục",
  };
}

function matchAiCartDraftItems(rawItems: unknown[], products: PosProduct[]) {
  const matched: Array<{ product: PosProduct; quantity: number }> = [];
  const unresolved: PosAiUnresolvedItem[] = [];
  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as PosAiCartDraftItem;
    const name = normalizeSearch(item.productName ?? "");
    const sku = normalizeSearch(item.sku ?? "");
    const product = products.find((candidate) =>
      (!candidate.isVariantParent) &&
      (
        (!!item.productId && candidate.id === item.productId) ||
        (!!sku && normalizeSearch(candidate.sku ?? "") === sku) ||
        (!!name && normalizeSearch(candidate.name) === name)
      )
    );
    if (!product) {
      const pending = pendingAiCartItem(raw, index);
      if (pending) unresolved.push(pending);
      return;
    }
    matched.push({ product, quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)) });
  });
  return { matched, unresolved };
}

function aiProductDraftItemsFromQuery(params: URLSearchParams) {
  const raw = params.get("aiProducts");
  if (!raw) return [];
  return raw.split(",")
    .map((productId) => productId.trim())
    .filter(Boolean)
    .map((productId) => ({ productId, quantity: 1 }));
}

/** Giá gốc theo bảng giá đã chọn (id). Bảng mặc định/"" → retailPrice; bảng khác → override, fallback retailPrice. */
function basePriceFor(p: PosProduct, priceBook: PriceBook = ""): number {
  const ov = priceBook ? p.prices?.[priceBook] : undefined;
  return Number(ov ?? p.retailPrice);
}

/** Giá của 1 đơn vị: priceOverride nếu có, không thì giá gốc × hệ số. */
function unitPriceFor(p: PosProduct, unit: PosUnit | null, priceBook: PriceBook = ""): number {
  const base = basePriceFor(p, priceBook);
  if (!unit) return base;
  if (unit.priceOverride != null) {
    // override là giá lẻ của đơn vị đó — áp tỷ lệ nhóm khách như giá gốc
    const ratio = Number(p.retailPrice) > 0 ? base / Number(p.retailPrice) : 1;
    return Math.round(Number(unit.priceOverride) * ratio);
  }
  return Math.round(base * Number(unit.multiplier));
}

function productChildren(p: PosProduct): PosProduct[] {
  return (p.children ?? []) as PosProduct[];
}

function flattenProducts(products: PosProduct[]): PosProduct[] {
  return products.flatMap((p) => [p, ...productChildren(p)]);
}

function priceLabelFor(p: PosProduct, priceBook: PriceBook = ""): string {
  if (p.isVariantParent) {
    const min = Number(p.minRetailPrice ?? p.retailPrice);
    const max = Number(p.maxRetailPrice ?? p.retailPrice);
    return min !== max ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(max);
  }
  return formatCurrency(basePriceFor(p, priceBook));
}

/** id đơn sinh ở client để khử trùng khi đồng bộ offline (ngoài render scope). */
function makeClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Mã phiếu tạm theo thời gian (ngoài render scope — tránh lint react-compiler). */
function makeTempSlipCode(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `TT${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function buildVietQrImageUrl(input: { bankCode: string; accountNumber: string; amount: number; reference: string }) {
  const params = new URLSearchParams({
    acc: input.accountNumber,
    bank: input.bankCode,
    amount: String(Math.round(input.amount)),
    des: input.reference,
  });
  return `https://qr.sepay.vn/img?${params.toString()}`;
}

function currentTimestamp(): number {
  return Date.now();
}

export function PosClient({
  data,
  printTemplate,
  quotePrintTemplate,
  bookingPrintTemplate,
  returnPrintTemplate,
  initialSourceInvoice,
  initialContext,
  posPrefs,
}: {
  data: PosData;
  printTemplate: PrintTemplate;
  quotePrintTemplate: PrintTemplate;
  bookingPrintTemplate: PrintTemplate;
  returnPrintTemplate: PrintTemplate;
  initialSourceInvoice?: PosSourceInvoice | null;
  initialContext?: PosInitialContext | null;
  posPrefs: StorePrefs["pos"];
}) {
  const t = useTranslations();

  const [search, setSearch] = useState("");
  const [submittingMode, setSubmittingMode] = useState<"sale" | "quote" | "booking" | "return" | null>(null);
  const submitting = submittingMode !== null;
  const [error, setError] = useState("");
  const [sepayCheckout, setSepayCheckout] = useState<SepayCheckout | null>(null);
  // kéo thả: sắp xếp dòng trong giỏ + thả SP từ danh sách vào giỏ
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [mobileView, setMobileView] = useState<"catalog" | "cart">("catalog"); // chuyển đổi trên mobile
  const [customerOptions, setCustomerOptions] = useState<PosCustomer[]>(() => data.customers);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [variantParent, setVariantParent] = useState<PosProduct | null>(null);
  const [browsing, setBrowsing] = useState(false); // click vào ô tìm → mở dropdown SP
  const searchRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [addMenuPosition, setAddMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [printSize, setPrintSize] = useState<PaperSize | null>(null); // đang in phiếu tạm
  const [printDefaultSize, setPrintDefaultSize] = useState<PaperSize>(printTemplate.paperDefault);
  const [printJob, setPrintJob] = useState<PosPrintJob | null>(null);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = localStorage.getItem(PRINT_SIZE_KEY);
        if (saved === "a4" || saved === "a5" || saved === "k80") setPrintDefaultSize(saved);
      } catch { /* localStorage unavailable */ }
    });
    return () => { cancelled = true; };
  }, []);
  // In phiếu tạm: ẩn app, chỉ hiện phiếu, gọi in trình duyệt rồi khôi phục.
  useEffect(() => {
    if (!printSize) return;
    document.body.classList.add("pos-printing");
    const restore = () => { document.body.classList.remove("pos-printing"); setPrintSize(null); setPrintJob(null); };
    window.addEventListener("afterprint", restore, { once: true });
    const id = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(id); window.removeEventListener("afterprint", restore); document.body.classList.remove("pos-printing"); };
  }, [printSize]);
  // Đóng dropdown tìm kiếm khi click ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!browsing && !search.trim()) return;
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) { setBrowsing(false); setSearch(""); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setBrowsing(false); setSearch(""); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [browsing, search]);
  const [editKey, setEditKey] = useState<string | null>(null); // dòng đang mở popup sửa giá

  // nhiều hóa đơn cùng lúc (tab). id đầu cố định để khớp SSR.
  const [invoices, setInvoices] = useState<PosDraft[]>(() => [
    makeInvoice(FIRST_INV_ID),
    ...(initialSourceInvoice
      ? [makeDraftFromSource(initialSourceInvoice, data.products, SOURCE_INV_ID)]
      : initialContext
        ? [makeDraftFromContext(initialContext)]
        : []),
  ]);
  const [activeId, setActiveId] = useState(initialSourceInvoice || initialContext ? SOURCE_INV_ID : FIRST_INV_ID);

  // load đơn đang soạn sau khi mount (tránh lệch SSR; defer cho react-compiler)
  useEffect(() => {
    if (initialSourceInvoice || initialContext) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("aiDraft") === "1") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = loadInvoices();
      if (saved) {
        setInvoices(saved);
        const savedActive = localStorage.getItem(ACT_KEY);
        setActiveId(savedActive && saved.some((i) => i.id === savedActive) ? savedActive : saved[0].id);
      }
    });
    return () => { cancelled = true; };
  }, [initialContext, initialSourceInvoice]);

  // ghi localStorage mỗi khi đơn đổi (bỏ qua lần đầu để không ghi đè bản đã lưu)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (initialSourceInvoice || initialContext) return;
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    saveInvoices(invoices);
  }, [initialContext, invoices, initialSourceInvoice]);

  // nhớ tab đang mở (giữ khi chuyển trang rồi quay lại)
  useEffect(() => {
    if (!initialSourceInvoice && !initialContext && hydratedRef.current) {
      try { localStorage.setItem(ACT_KEY, activeId); } catch { /* bỏ qua */ }
    }
  }, [activeId, initialContext, initialSourceInvoice]);

  useEffect(() => {
    if (!sepayCheckout || sepayCheckout.status !== "pending") return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/payments/sepay/${sepayCheckout.paymentId}`, { cache: "no-store" });
        const result = await response.json() as { ok: boolean; data?: { status?: string } };
        if (cancelled || !result.ok || !result.data?.status) return;
        setSepayCheckout((current) =>
          current?.paymentId === sepayCheckout.paymentId ? { ...current, status: result.data?.status ?? current.status } : current
        );
        if (["confirmed", "reconciled", "manual_confirmed"].includes(result.data.status)) {
          window.clearInterval(id);
          setPrintJob(sepayCheckout.printJob);
          setPrintSize(printDefaultSize);
        }
      } catch {
        // Polling is best-effort; webhook remains source of truth.
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sepayCheckout, printDefaultSize]);

  const active = invoices.find((i) => i.id === activeId) ?? invoices[0];
  const sourceInvoice = active.source ?? null;
  const {
    cart,
    customerId,
    projectId,
    projectName,
    deliveryDate,
    discountInput,
    discountMode,
    taxRate,
    shippingFee,
    payMethod,
    paidInput,
    note: orderNote,
    returnOrderId,
    returnOrderCode,
    returnReason,
    returnRestock,
  } = active;
  const activeKind = active.kind ?? "invoice";
  const isInvoiceDraft = activeKind === "invoice";
  const isQuoteDraft = activeKind === "quote";
  const isCameraQuoteDraft = isQuoteDraft && active.cameraQuote === true;
  const isBookingDraft = activeKind === "booking";
  const isReturnDraft = isReturnKind(activeKind);
  const isReturnInvoiceDraft = activeKind === "return_invoice";
  const priceBook: PriceBook = active.priceBook ?? ""; // "" = bảng giá mặc định
  const defaultBook = data.priceBooks.find((b) => b.isDefault) ?? data.priceBooks[0];
  const isDefaultBook = !priceBook || priceBook === defaultBook?.id;

  /** Patch hóa đơn đang mở (nhận object hoặc hàm cập nhật). */
  const patchActive = useCallback((patch: Partial<PosDraft> | ((inv: PosDraft) => Partial<PosDraft>)) => {
    setInvoices((list) =>
      list.map((inv) => (inv.id === activeId ? { ...inv, ...(typeof patch === "function" ? patch(inv) : patch) } : inv))
    );
  }, [activeId]);
  // setter giữ nguyên chữ ký cũ để JSX bên dưới không phải đổi
  const setCart = useCallback((v: CartLine[] | ((c: CartLine[]) => CartLine[])) =>
    patchActive((inv) => ({ cart: typeof v === "function" ? v(inv.cart) : v })), [patchActive]);
  const setProjectId = (v: string) => patchActive({ projectId: v });
  const setProjectName = (v: string) => patchActive({ projectName: v });
  const setDeliveryDate = (v: string) => patchActive({ deliveryDate: v });
  const setDiscountInput = (v: number) => patchActive({ discountInput: v });
  const setDiscountMode = (v: "vnd" | "pct") => patchActive({ discountMode: v });
  const setTaxRate = (v: number) => patchActive({ taxRate: v });
  const setShippingFee = (v: number) => patchActive({ shippingFee: v });
  const setOrderNote = (v: string) => patchActive({ note: v });
  const setPayMethod = (v: PayMethod) => patchActive({ payMethod: v });
  const setPaidInput = (v: number | null) => patchActive({ paidInput: v });
  const setReturnReason = (v: string) => patchActive({ returnReason: v });
  const setReturnRestock = (v: boolean) => patchActive({ returnRestock: v });
  const setReturnSourceOrder = (order: ReturnableOrderOption | null) => patchActive({
    returnOrderId: order?.id,
    returnOrderCode: order?.code,
    customerId: order?.customerId ?? customerId,
  });

  /** Thêm tab POS mới và chuyển sang nó. */
  function addDraft(kind: PosDraftKind, cameraQuote = false) {
    const inv = { ...makeDraft(undefined, kind), cameraQuote };
    setInvoices((list) => [...list, inv]);
    setActiveId(inv.id);
    setAddMenuOpen(false);
    setError("");
  }

  function toggleAddMenu() {
    const rect = addMenuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setAddMenuPosition({
        top: rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 210),
      });
    }
    setAddMenuOpen((open) => !open);
  }

  /** Đóng 1 tab; luôn giữ tối thiểu 1 đơn. */
  function closeInvoice(id: string) {
    setInvoices((list) => {
      const closingFirstInvoice = list.length > 1 && list[0]?.id === id && (list[0].kind ?? "invoice") === "invoice";
      if (closingFirstInvoice) {
        setActiveId(id);
        return [makeInvoice(id), ...list.slice(1)];
      }
      const next = list.filter((i) => i.id !== id);
      const final = ensureInvoiceFirst(next.length > 0 ? next : [makeInvoice()]);
      if (id === activeId) setActiveId(final[Math.max(0, list.findIndex((i) => i.id === id) - 1)]?.id ?? final[0].id);
      return final;
    });
  }

  const customer = useMemo(
    () => customerOptions.find((c) => c.id === customerId) ?? null,
    [customerId, customerOptions]
  );
  const searchableProducts = useMemo(() => flattenProducts(data.products), [data.products]);
  const productById = useMemo(() => new Map(searchableProducts.map((product) => [product.id, product])), [searchableProducts]);
  const cameraPackages = active.cameraPackages ?? [];

  const cameraPackagesToCart = useCallback((packages: CameraQuotePackage[]) => {
    return packages.flatMap((pkg, packageIndex) => {
      const packageItems = [
        { productId: pkg.cameraId, quantity: pkg.quantity },
        { productId: pkg.cardId, quantity: pkg.quantity },
        { productId: pkg.installationId, quantity: pkg.quantity },
        ...pkg.materialLines.map((line) => ({ productId: line.productId, quantity: pkg.quantity * line.quantity })),
      ];
      return packageItems.flatMap((item, itemIndex) => {
        const product = productById.get(item.productId);
        if (!product) return [];
        return [{
          key: `camera-${pkg.key}-${itemIndex}`,
          product,
          unitName: product.baseUnit,
          unitMultiplier: 1,
          unitPrice: unitPriceFor(product, null, priceBook),
          quantity: item.quantity,
          note: t("pos.cameraQuote.packageNote", { n: String(packageIndex + 1).padStart(2, "0") }),
        }];
      });
    });
  }, [productById, priceBook, t]);

  function setCameraPackages(packages: CameraQuotePackage[]) {
    patchActive({ cameraPackages: packages, cart: cameraPackagesToCart(packages) });
  }

  useEffect(() => {
    if (!initialContext?.cameraQuote || !active.cameraQuote || active.cameraPackages?.length || !active.cameraInitialId) return;
    const camera = productById.get(active.cameraInitialId);
    const card = searchableProducts.find((product) => product.sku === "MEM-IMOU-64GB");
    const installation = searchableProducts.find((product) => product.sku === "SVC-CAM-INSTALL-200");
    const material = searchableProducts.find((product) => product.sku === "MAT-CAM-BASIC-50");
    if (!camera || !card || !installation || !material) return;
    const packages: CameraQuotePackage[] = [{
      key: `camera-package-${Date.now()}`,
      cameraId: camera.id,
      cardId: card.id,
      installationId: installation.id,
      materialLines: [{ productId: material.id, quantity: 1 }],
      quantity: 1,
    }];
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) patchActive({ cameraPackages: packages, cart: cameraPackagesToCart(packages), cameraInitialId: undefined });
    });
    return () => { cancelled = true; };
  }, [active.cameraInitialId, active.cameraPackages?.length, active.cameraQuote, initialContext?.cameraQuote, productById, searchableProducts, patchActive, cameraPackagesToCart]);

  // Khi gõ tìm kiếm: hỏi server (quét toàn bộ SP, bỏ dấu) — khớp trang Sản phẩm.
  const [serverResults, setServerResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [returnSourceQuery, setReturnSourceQuery] = useState("");
  const [returnSourceOptions, setReturnSourceOptions] = useState<ReturnableOrderOption[]>([]);
  const [returnSourceSearching, setReturnSourceSearching] = useState(false);
  // ===== offline (Mức A) =====
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [aiUnresolvedItems, setAiUnresolvedItems] = useState<PosAiUnresolvedItem[]>([]);
  const [aiQuickOpen, setAiQuickOpen] = useState(false);
  const [aiHighlightedProductIds, setAiHighlightedProductIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);

  /** Khi chỉ có một tab, nút X sẽ làm trống hóa đơn thay vì đóng tab. */
  function clearInvoice(id: string) {
    setInvoices((list) => list.map((inv) => {
      if (inv.id !== id) return inv;
      const next = makeDraft(id, inv.kind ?? "invoice");
      next.cameraQuote = inv.cameraQuote;
      return next;
    }));
    setActiveId(id);
    setError("");
    setAiUnresolvedItems([]);
    setAiHighlightedProductIds([]);
  }

  useEffect(() => {
    const q = search.trim();
    let cancelled = false;
    const h = setTimeout(() => {
      if (cancelled) return;
      if (!q) { setServerResults([]); setSearching(false); return; }
      // offline → lọc cục bộ trên SP đã tải; online → hỏi server
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const nq = normalizeSearch(q);
        setServerResults(searchableProducts.filter((p) => normalizeSearch(`${p.name} ${p.sku} ${p.barcode ?? ""}`).includes(nq)));
        setSearching(false);
        return;
      }
      setSearching(true);
      searchPosProducts(q)
        .then((res) => { if (!cancelled) { setServerResults(res); setSearching(false); } })
        .catch(() => { if (!cancelled) { // mất mạng giữa chừng → lọc cục bộ
          const nq = normalizeSearch(q);
          setServerResults(searchableProducts.filter((p) => normalizeSearch(`${p.name} ${p.sku} ${p.barcode ?? ""}`).includes(nq)));
          setSearching(false);
        } });
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(h); };
  }, [search, searchableProducts]);

  useEffect(() => {
    if (!isReturnInvoiceDraft) return;
    const q = returnSourceQuery.trim();
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      if (!q) {
        setReturnSourceOptions([]);
        setReturnSourceSearching(false);
        return;
      }
      setReturnSourceSearching(true);
      searchReturnableOrders(q)
        .then((rows) => {
          if (!cancelled) {
            setReturnSourceOptions(rows);
            setReturnSourceSearching(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setReturnSourceOptions([]);
            setReturnSourceSearching(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [isReturnInvoiceDraft, returnSourceQuery]);

  const syncingRef = useRef(false);
  async function flushOutbox() {
    if (syncingRef.current || !navigator.onLine) return;
    const items = (await getOutbox()).filter((x) => !x.failed);
    if (items.length === 0) return;
    syncingRef.current = true; setSyncing(true);
    for (const it of items) {
      if (!navigator.onLine) break;
      try {
        const res = await createOrder(it.payload as Parameters<typeof createOrder>[0]);
        if (res.ok) await removeOutbox(it.localId);
        else await markFailed(it.localId, res.error); // lỗi nghiệp vụ → giữ lại, không lặp vô hạn
      } catch { break; } // vẫn mất mạng → thử lại sau
    }
    const remain = await getOutbox();
    setPending(remain.filter((x) => !x.failed).length);
    setSyncing(false); syncingRef.current = false;
  }

  // cache catalog + theo dõi online/offline + đếm đơn chờ (defer setState cho react-compiler)
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOnline(navigator.onLine);
      saveCatalog({ products: data.products, customers: customerOptions, savedAt: Date.now() });
      getOutbox().then((o) => { if (!cancelled) setPending(o.filter((x) => !x.failed).length); });
      flushOutbox();
    });
    const on = () => { setOnline(true); flushOutbox(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { cancelled = true; window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void saveCatalog({ products: data.products, customers: customerOptions, savedAt: Date.now() });
  }, [customerOptions, data.products]);

  const filtered = useMemo(() => {
    // có từ khoá → dùng kết quả server; không → lưới SP mặc định
    return search.trim() ? serverResults : data.products;
  }, [search, serverResults, data.products]);

  /**
   * Giá bán hiệu lực mỗi đơn vị. Nếu sửa giá tay → đơn giá − giảm giá tay
   * (bỏ qua KM). Nếu không → áp KM bậc thang theo SL đơn vị gốc.
   */
  function effPrice(l: CartLine): { price: number; pct: number } {
    if (l.manualPrice) {
      const price = Math.max(0, l.unitPrice - (l.lineDiscount ?? 0));
      const pct = l.unitPrice > 0 ? Math.round((1 - price / l.unitPrice) * 100) : 0;
      return { price, pct };
    }
    return applyPromo(l.unitPrice, data.promoByProduct[l.product.id], l.quantity * l.unitMultiplier);
  }

  /** Sửa giá/giảm giá 1 dòng (từ popup). */
  function applyLinePrice(key: string, unitPrice: number, lineDiscount: number) {
    setCart((c) => c.map((l) =>
      l.key === key
        ? { ...l, unitPrice: Math.max(0, unitPrice), lineDiscount: Math.max(0, lineDiscount), manualPrice: true }
        : l
    ));
    setEditKey(null);
  }

  const subtotal = cart.reduce((s, l) => s + effPrice(l).price * l.quantity, 0);
  const returnQuantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const hasReturnQuantity = returnQuantity > 0;
  const discountVnd = isReturnDraft ? 0 : discountMode === "pct" ? Math.round(subtotal * discountInput / 100) : discountInput;
  const taxAmount = isReturnDraft ? 0 : Math.round((subtotal - discountVnd) * taxRate / 100);
  const total = isReturnDraft ? subtotal : Math.max(0, subtotal - discountVnd + taxAmount + shippingFee);
  const paid = payMethod === "credit" ? 0 : (paidInput ?? total);
  const payableAmount = Math.min(Math.max(0, paid), total);
  const remaining = Math.max(0, total - paid);

  function changePrintDefaultSize(size: PaperSize) {
    setPrintDefaultSize(size);
    try {
      localStorage.setItem(PRINT_SIZE_KEY, size);
    } catch { /* localStorage unavailable */ }
  }

  function startPrint(job: PosPrintJob, size = printDefaultSize) {
    setPrintJob(job);
    setPrintSize(size);
  }

  function buildPrintJob(input: { template: PrintTemplate; title: string; code: string; paymentQr?: PosPrintPaymentQr | null }): PosPrintJob {
    const printLines = isReturnDraft ? cart.filter((line) => line.quantity > 0) : cart;
    return {
      template: input.template,
      title: input.title,
      code: input.code,
      date: new Date().toISOString(),
      partyName: customer?.name ?? t("pos.walkInCustomer"),
      partyPhone: customer?.phone,
      projectName: projectName || null,
      items: printLines.map((line) => ({ ...line })),
      totals: {
        subtotal,
        discount: discountVnd,
        tax: taxAmount,
        shipping: shippingFee,
      },
      grandTotal: total,
      paid: isInvoiceDraft ? payableAmount : 0,
      remaining: isInvoiceDraft ? remaining : total,
      payMethod: isInvoiceDraft ? payMethod : "credit",
      paymentQr: input.paymentQr ?? null,
    };
  }

  function addToCart(p: PosProduct) {
    if (p.isVariantParent) {
      setVariantParent(p);
      return;
    }
    setCart((c) => {
      const existing = c.find((l) => l.product.id === p.id);
      if (existing) {
        return c.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      // mặc định: đơn vị đầu tiên nếu có, không thì đơn vị gốc
      const unit = p.units[0] ?? null;
      return [...c, {
        key: `${p.id}-${Date.now()}`,
        product: p,
        unitName: unit?.unitName ?? p.baseUnit,
        unitMultiplier: unit ? Number(unit.multiplier) : 1,
        unitPrice: unitPriceFor(p, unit, priceBook),
        quantity: 1,
      }];
    });
  }

  const addQuantityToCart = useCallback((p: PosProduct, quantity: number) => {
    const safeQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
    setCart((c) => {
      const existing = c.find((l) => l.product.id === p.id);
      if (existing) {
        return c.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + safeQuantity } : l));
      }
      const unit = p.units[0] ?? null;
      return [...c, {
        key: `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        product: p,
        unitName: unit?.unitName ?? p.baseUnit,
        unitMultiplier: unit ? Number(unit.multiplier) : 1,
        unitPrice: unitPriceFor(p, unit, priceBook),
        quantity: safeQuantity,
      }];
    });
  }, [priceBook, setCart]);

  const applyRawAiCartItems = useCallback((rawItems: unknown[], payload?: Record<string, unknown>) => {
    const { matched, unresolved } = matchAiCartDraftItems(rawItems, searchableProducts);
    setAiUnresolvedItems(unresolved);
    if (matched.length === 0) return false;
    for (const line of matched) addQuantityToCart(line.product, line.quantity);
    const productIds = [...new Set(matched.map((line) => line.product.id))];
    setAiHighlightedProductIds(productIds);
    window.setTimeout(() => {
      setAiHighlightedProductIds((current) => current.filter((id) => !productIds.includes(id)));
    }, 3600);
    if (payload) {
      const payment = payload.payment && typeof payload.payment === "object" ? payload.payment as Record<string, unknown> : {};
      patchActive({
        customerId: typeof payload.customerId === "string" ? payload.customerId : "",
        discountInput: Number(payload.discount) || 0,
        discountMode: "vnd",
        taxRate: Number(payload.taxRate) || 0,
        shippingFee: Number(payload.shippingFee) || 0,
        payMethod: payment.method === "credit" || payment.method === "bank_transfer" || payment.method === "cash" ? payment.method : "cash",
        paidInput: Number(payment.amount) || null,
        note: typeof payload.note === "string" ? payload.note : undefined,
      });
    }
    setMobileView("cart");
    setBrowsing(false);
    setSearch("");
    return true;
  }, [addQuantityToCart, patchActive, searchableProducts]);

  function applyAiCartPreview(preview: AiActionPreview) {
    if (preview.intent !== "pos_voice_cart_draft" && preview.intent !== "pos_image_cart_draft") return;
    const payload = preview.action.payload;
    const rawItems = [
      ...(Array.isArray(payload.items) ? payload.items : []),
      ...(Array.isArray(payload.unresolvedItems) ? payload.unresolvedItems : []),
    ];
    applyRawAiCartItems(rawItems);
  }

  useEffect(() => {
    const onAiCartDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ items?: unknown; payload?: Record<string, unknown> }>).detail;
      const payload = detail?.payload && typeof detail.payload === "object" ? detail.payload : {};
      const rawItems = [
        ...(Array.isArray(detail?.items) ? detail.items : []),
        ...(Array.isArray(payload.unresolvedItems) ? payload.unresolvedItems : []),
      ];
      applyRawAiCartItems(rawItems);
    };
    window.addEventListener("luma:pos-ai-cart-draft", onAiCartDraft);
    return () => window.removeEventListener("luma:pos-ai-cart-draft", onAiCartDraft);
  }, [applyRawAiCartItems]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("aiDraft") !== "1") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let stored: PosAiCartDraftPayload | null = null;
      try {
        stored = JSON.parse(localStorage.getItem(AI_POS_DRAFT_KEY) ?? "null") as PosAiCartDraftPayload | null;
      } catch {
        stored = null;
      }
      const storedItems = Array.isArray(stored?.items) ? stored.items : [];
      const payload = stored?.payload && typeof stored.payload === "object" ? stored.payload : {};
      const payloadUnresolvedItems = Array.isArray(payload.unresolvedItems) ? payload.unresolvedItems : [];
      const rawItems = storedItems.length > 0 ? [...storedItems, ...payloadUnresolvedItems] : aiProductDraftItemsFromQuery(params);
      if (rawItems.length > 0) hydratedRef.current = true;
      const consumed = applyRawAiCartItems(rawItems, payload);
      if (consumed) localStorage.removeItem(AI_POS_DRAFT_KEY);
      params.delete("aiDraft");
      params.delete("aiProducts");
      const query = params.toString();
      window.history.replaceState(null, "", query ? `/pos?${query}` : "/pos");
    });
    return () => { cancelled = true; };
  }, [applyRawAiCartItems, searchableProducts]);

  function selectProduct(p: PosProduct) {
    if (p.isVariantParent && productChildren(p).length > 0) {
      setVariantParent(p);
      return;
    }
    addToCart(p);
  }

  /** Di chuyển dòng `from` đến vị trí của dòng `to` (kéo thả sắp xếp). */
  function moveLine(from: string, to: string) {
    setCart((c) => {
      const fi = c.findIndex((l) => l.key === from);
      const ti = c.findIndex((l) => l.key === to);
      if (fi < 0 || ti < 0 || fi === ti) return c;
      const next = [...c];
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  }

  function changeUnit(key: string, unitName: string) {
    setCart((c) => c.map((l) => {
      if (l.key !== key) return l;
      const unit = l.product.units.find((u) => u.unitName === unitName) ?? null;
      // đổi đơn vị → tính lại giá niêm yết, bỏ sửa giá tay cũ
      return {
        ...l,
        unitName: unit?.unitName ?? l.product.baseUnit,
        unitMultiplier: unit ? Number(unit.multiplier) : 1,
        unitPrice: unitPriceFor(l.product, unit, priceBook),
        lineDiscount: 0,
        manualPrice: false,
      };
    }));
  }

  function setLineNote(key: string, note: string) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, note } : l)));
  }

  function changeCustomer(id: string) {
    patchActive({ customerId: id });
  }

  function applyCreatedCustomer(created: CustomerCreateResult) {
    const next: PosCustomer = {
      id: created.id,
      name: created.name,
      phone: created.phone || null,
      type: created.type,
      currentDebt: "0",
      debtLimit: String(created.debtLimit ?? 0),
    };
    setCustomerOptions((list) => [next, ...list.filter((item) => item.id !== next.id)]);
    changeCustomer(next.id);
    setCustomerCreateOpen(false);
  }

  /** Đổi bảng giá cho đơn đang mở + tính lại giá toàn giỏ (giữ dòng sửa giá tay). */
  function changePriceBook(pb: PriceBook) {
    patchActive((inv) => ({
      priceBook: pb,
      cart: inv.cart.map((l) => {
        if (l.manualPrice) return l;
        const unit = l.product.units.find((u) => u.unitName === l.unitName) ?? null;
        return { ...l, unitPrice: unitPriceFor(l.product, unit, pb) };
      }),
    }));
  }

  function updateQty(key: string, delta: number) {
    setCart((c) =>
      c.map((l) => (l.key === key ? { ...l, quantity: clampLineQuantity(l, l.quantity + delta) } : l))
        .filter((l) => isReturnDraft || l.quantity > 0)
    );
  }

  function setQty(key: string, qty: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: clampLineQuantity(l, qty) } : l)).filter((l) => isReturnDraft || l.quantity > 0));
  }

  function clampLineQuantity(line: CartLine, qty: number) {
    const normalized = Math.max(0, qty);
    return line.returnSoldQuantity == null ? normalized : Math.min(normalized, line.returnSoldQuantity);
  }

  async function submitOrder(mode: "sale" | "quote" | "booking") {
    if (cart.length === 0 || !data.warehouse || submitting) return;
    const submitMode = sourceInvoice ? sourceInvoice.kind === "quote" ? "quote" : sourceInvoice.kind === "booking" ? "booking" : mode : mode;
    const isCheckoutMode = submitMode === "sale";
    if (submitMode === "sale" && payMethod === "credit" && !customerId) {
      setError(t("pos.errors.creditNeedsCustomer"));
      return;
    }
    if (submitMode === "sale" && payMethod === "bank_transfer" && payableAmount <= 0) {
      setError(t("pos.sepay.invalidAmount"));
      return;
    }
    if (sourceInvoice && typeof navigator !== "undefined" && !navigator.onLine) {
      setError(t("pos.invoiceEdit.onlineRequired"));
      return;
    }
    const orderSource = sourceInvoice?.id && (sourceInvoice.mode === "edit" || sourceInvoice.mode === "copy")
      ? { mode: sourceInvoice.mode, orderId: sourceInvoice.id }
      : undefined;
    const payload = {
      mode: submitMode,
      clientId: makeClientId(), // khử trùng khi đồng bộ offline
      source: orderSource,
      customerId: customerId || null,
      warehouseId: data.warehouse.id,
      projectId: projectId || null,
      projectName: projectName || undefined,
      deliveryDate: submitMode === "booking" && deliveryDate ? deliveryDate : undefined,
      discount: discountVnd,
      taxRate,
      shippingFee,
      priceBookId: priceBook || null,
      items: cart.map((l) => ({
        productId: l.product.id,
        productName: l.product.name,
        unitName: l.unitName,
        unitMultiplier: l.unitMultiplier,
        quantity: l.quantity,
        manualUnitPrice: l.manualPrice ? l.unitPrice : undefined,
        lineDiscount: l.lineDiscount ?? 0,
      })),
      payment: { method: isCheckoutMode ? payMethod : "credit", amount: isCheckoutMode && payMethod !== "bank_transfer" ? paid : 0 },
    };
    setSubmittingMode(submitMode);
    setError("");

    // offline → xếp hàng chờ đồng bộ
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (payMethod === "bank_transfer") {
        setSubmittingMode(null);
        setError(t("pos.sepay.onlineRequired"));
        return;
      }
      await queueOffline(payload);
      return;
    }
    try {
      const res = await createOrder(payload);
      if (res.ok) {
        if (submitMode === "sale" && payMethod === "bank_transfer") {
          const paymentRes = await fetch("/api/payments/sepay", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              orderId: res.data.id,
              amount: payableAmount,
              note: res.data.code,
            }),
          });
          const paymentJson = await paymentRes.json() as {
            ok: boolean;
            data?: Omit<SepayCheckout, "orderId" | "orderCode" | "printJob">;
            error?: string;
          };
          setSubmittingMode(null);
          if (!paymentJson.ok || !paymentJson.data) {
            setError(paymentJson.error ? t(paymentJson.error) : t("pos.sepay.createFailed"));
            return;
          }
          const paymentQr: PosPrintPaymentQr = {
            title: t("pos.sepay.title"),
            qrImageUrl: paymentJson.data.qrImageUrl,
            bankLabel: t("pos.sepay.bank"),
            accountLabel: t("pos.sepay.account"),
            nameLabel: t("pos.sepay.name"),
            referenceLabel: t("pos.sepay.reference"),
            bankName: paymentJson.data.bankAccount.gateway ?? paymentJson.data.bankAccount.bankCode,
            accountNumber: paymentJson.data.bankAccount.accountNumber,
            accountName: paymentJson.data.bankAccount.accountName,
            reference: paymentJson.data.reference,
          };
          const printJob = buildPrintJob({
            template: printTemplate,
            title: t("print.titles.order"),
            code: res.data.code,
            paymentQr,
          });
          closeInvoice(activeId);
          setSepayCheckout({ ...paymentJson.data, orderId: res.data.id, orderCode: res.data.code, printJob });
          return;
          }
        const printJob = buildPrintJob({
          template: submitMode === "quote" ? quotePrintTemplate : submitMode === "booking" ? bookingPrintTemplate : printTemplate,
          title: submitMode === "quote" ? t("print.titles.quote") : submitMode === "booking" ? t("print.titles.booking") : t("print.titles.order"),
          code: res.data.code,
        });
        setSubmittingMode(null);
        closeInvoice(activeId);
        startPrint(printJob, submitMode === "quote" ? quotePrintTemplate.paperDefault : submitMode === "booking" ? bookingPrintTemplate.paperDefault : printDefaultSize);
      } else {
        setSubmittingMode(null);
        setError(t(res.error));
      }
    } catch {
      if (payMethod === "bank_transfer") {
        setSubmittingMode(null);
        setError(t("pos.sepay.createFailed"));
        return;
      }
      // mất mạng giữa chừng → xếp hàng offline
      await queueOffline(payload);
    }
  }

  async function submitReturn() {
    if (!hasReturnQuantity || !data.warehouse || submitting) return;
    if (isReturnInvoiceDraft && !returnOrderId) {
      setError(t("pos.returns.sourceRequired"));
      return;
    }
    if (payMethod === "credit" && !customerId) {
      setError(t("returns.errors.debtNeedsCustomer"));
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(t("pos.returns.onlineRequired"));
      return;
    }

    setSubmittingMode("return");
    setError("");
    try {
      const res = await createPosReturn({
        orderId: isReturnInvoiceDraft ? returnOrderId : undefined,
        customerId: customerId || null,
        warehouseId: data.warehouse.id,
        priceBookId: priceBook || null,
        reason: returnReason || "other",
        refundMethod: payMethod === "credit" ? "debt_deduct" : payMethod,
        note: orderNote || undefined,
        items: cart.filter((l) => l.quantity > 0).map((l) => ({
          productId: l.product.id,
          productName: l.product.name,
          unitName: l.unitName,
          unitMultiplier: l.unitMultiplier,
          quantity: l.quantity,
          manualUnitPrice: l.manualPrice ? l.unitPrice : undefined,
          lineDiscount: l.lineDiscount ?? 0,
          restock: returnRestock ?? true,
        })),
      });
      if (res.ok) {
        const printJob = buildPrintJob({
          template: returnPrintTemplate,
          title: t("print.titles.return"),
          code: returnOrderCode ? `${res.data.code} ← ${returnOrderCode}` : res.data.code,
        });
        setSubmittingMode(null);
        closeInvoice(activeId);
        startPrint(printJob, returnPrintTemplate.paperDefault);
      } else {
        setSubmittingMode(null);
        setError(t(res.error));
      }
    } catch {
      setSubmittingMode(null);
      setError(t("errors.serverError"));
    }
  }

  /** Lưu đơn vào hàng đợi offline + báo người dùng. */
  async function queueOffline(payload: Parameters<typeof createOrder>[0]) {
    // localId = clientId của đơn → sync lại dùng đúng clientId, server khử trùng.
    await enqueueOrder({ localId: payload.clientId ?? makeClientId(), payload, savedAt: currentTimestamp() });
    setSubmittingMode(null);
    setPending((c) => c + 1);
    closeInvoice(activeId);
    setOfflineSaved(true);
    setTimeout(() => setOfflineSaved(false), 3500);
  }
  const submitActiveDraft = () => isReturnDraft ? submitReturn() : submitOrder(isQuoteDraft ? "quote" : isBookingDraft ? "booking" : "sale");

  /** Mở in phiếu tạm theo khổ đã chọn. */
  const doPrint = (size: PaperSize) => {
    const code = makeTempSlipCode();
    startPrint(buildPrintJob({
      template: printTemplate,
      title: t("pos.tempSlipTitle"),
      code,
      paymentQr: payMethod === "bank_transfer" && data.defaultBankAccount
        ? {
            title: t("pos.sepay.title"),
            qrImageUrl: buildVietQrImageUrl({
              bankCode: data.defaultBankAccount.bankCode,
              accountNumber: data.defaultBankAccount.accountNumber,
              amount: payableAmount,
              reference: code,
            }),
            bankLabel: t("pos.sepay.bank"),
            accountLabel: t("pos.sepay.account"),
            nameLabel: t("pos.sepay.name"),
            referenceLabel: t("pos.sepay.reference"),
            bankName: data.defaultBankAccount.gateway ?? data.defaultBankAccount.bankCode,
            accountNumber: data.defaultBankAccount.accountNumber,
            accountName: data.defaultBankAccount.accountName,
            reference: code,
          }
        : null,
    }), size);
  };

  // Khu chính hiện lưới SP khi đang tìm hoặc khi bấm vào ô tìm; ngược lại hiện dòng hàng đã chọn.
  const showResults = browsing || search.trim() !== "";
  const closeSearch = () => { setBrowsing(false); setSearch(""); };
  const isEditMode = sourceInvoice?.mode === "edit";
  const isCopyMode = sourceInvoice?.mode === "copy";
  const showSourceInvoiceBanner = Boolean(sourceInvoice && sourceInvoice.mode !== "return");
  const sourceKind = sourceInvoice?.kind ?? "invoice";
  const sourceTitleTx = sourceKind === "quote"
    ? isEditMode ? "pos.invoiceEdit.editingQuoteFrom" : "pos.invoiceEdit.copyingQuoteFrom"
    : sourceKind === "booking"
      ? isEditMode ? "pos.invoiceEdit.editingBookingFrom" : "pos.invoiceEdit.copyingBookingFrom"
      : isEditMode ? "pos.invoiceEdit.editingFrom" : "pos.invoiceEdit.copyingFrom";
  const sourceDescriptionTx = sourceKind === "quote"
    ? isEditMode ? "pos.invoiceEdit.editQuoteDescription" : "pos.invoiceEdit.copyQuoteDescription"
    : sourceKind === "booking"
      ? isEditMode ? "pos.invoiceEdit.editBookingDescription" : "pos.invoiceEdit.copyBookingDescription"
      : isEditMode ? "pos.invoiceEdit.editDescription" : "pos.invoiceEdit.copyDescription";
  const sourcePrimaryLabel = isEditMode
    ? sourceKind === "quote" ? t("pos.invoiceEdit.saveEditedQuote") : sourceKind === "booking" ? t("pos.invoiceEdit.saveEditedBooking") : t("pos.invoiceEdit.saveEdited")
    : isCopyMode
      ? sourceKind === "quote" ? t("pos.invoiceEdit.createQuoteCopy") : sourceKind === "booking" ? t("pos.invoiceEdit.createBookingCopy") : t("pos.invoiceEdit.createCopy")
      : null;

  // Tabs hóa đơn — đặt cạnh thanh tìm kiếm (giống KiotViet).
  const invoiceTabs = (
    <div className="flex items-stretch gap-1.5 overflow-x-auto">
      {invoices.map((inv, idx) => {
        const count = inv.cart.reduce((s, l) => s + l.quantity, 0);
        const isActive = inv.id === activeId;
        const kind = inv.kind ?? "invoice";
        const ordinal = invoices.slice(0, idx + 1).filter((item) => (item.kind ?? "invoice") === kind).length;
        const TabIcon = isReturnKind(kind) ? RotateCcw : kind === "quote" ? FileText : kind === "booking" ? ClipboardList : ShoppingCart;
        return (
          <div
            key={inv.id}
            onClick={() => { setActiveId(inv.id); setError(""); }}
            className={cn(
              "group flex items-center gap-2 pl-4 pr-2 py-2.5 rounded-lg cursor-pointer whitespace-nowrap border text-sm transition-colors",
              isActive
                ? "bg-primary-50 border-primary-300 text-primary-700 font-semibold dark:bg-primary-950/50 dark:border-primary-800 dark:text-primary-300"
                : "bg-surface border-border text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            <TabIcon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary-600" : "text-slate-400")} />
            <span>{inv.cameraQuote ? t("pos.draftTabs.cameraQuote", { n: ordinal }) : t(`pos.draftTabs.${kind}`, { n: ordinal })}</span>
            {count > 0 && (
              <span className={cn(
                "min-w-[20px] text-center rounded-full px-1.5 text-xs font-bold",
                isActive ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300" : "bg-slate-200 dark:bg-slate-700"
              )}>{count}</span>
            )}
            {(invoices.length > 1 || inv.id === activeId) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (invoices.length > 1) closeInvoice(inv.id);
                  else clearInvoice(inv.id);
                }}
                className="p-0.5 rounded text-slate-400 hover:text-er hover:bg-slate-200/70 dark:hover:bg-slate-700"
                title={t(invoices.length > 1 ? "pos.invoice.close" : "pos.invoice.clear")}
                aria-label={t(invoices.length > 1 ? "pos.invoice.close" : "pos.invoice.clear")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <div className="relative shrink-0">
        <button
          ref={addMenuButtonRef}
          type="button"
          onClick={toggleAddMenu}
          title={t("pos.draftTabs.addLabel")}
          className="h-full px-3 py-2.5 rounded-lg border border-border text-slate-400 hover:text-primary-600 hover:border-primary-300"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Danh sách dòng hàng đã chọn — hiển thị ở khu chính (giống KiotViet).
  const orderLinesPanel = (
    <div className="flex-1 flex flex-col min-h-0 border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <h2 className="font-semibold text-sm">{isCameraQuoteDraft ? t("pos.cameraQuote.lineItems") : t("pos.order")} ({cart.length})</h2>
      </div>
      <div className="flex-1 overflow-auto">
        {cart.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-12">{t("pos.noItems")}</div>
        )}
        {cart.map((l, idx) => {
          const m2 = l.product.m2PerUnit ? Number(l.product.m2PerUnit) * l.unitMultiplier * l.quantity : 0;
          const eff = effPrice(l);
          const outOfStock = Number(l.product.stock) <= 0;
          return (
            <div
              key={l.key}
              data-line={l.key}
              onDragOver={(e) => {
                if (!dragKey || dragKey === l.key) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overKey !== l.key) setOverKey(l.key);
              }}
              onDragLeave={() => { if (overKey === l.key) setOverKey(null); }}
              onDrop={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                moveLine(dragKey, l.key);
                setDragKey(null);
                setOverKey(null);
              }}
              className={cn(
                "border-b border-border-soft last:border-0 transition-colors",
                aiHighlightedProductIds.includes(l.product.id) && "bg-primary-50/80 shadow-[inset_3px_0_0_var(--primary-500)] dark:bg-primary-950/30",
                dragKey === l.key && "opacity-50",
                overKey === l.key && dragKey && dragKey !== l.key && "bg-primary-50/40 dark:bg-primary-950/20"
              )}
            >
              <div className="flex items-center gap-2 px-3 py-3">
                <span className="w-5 text-center text-xs text-slate-400 shrink-0 tabular-nums">{idx + 1}</span>
                <button disabled={isCameraQuoteDraft} onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} className="text-slate-400 hover:text-er shrink-0 disabled:cursor-not-allowed disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
                <span className="w-24 text-sm text-slate-400 shrink-0 truncate">{l.product.sku ?? ""}</span>
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <button
                    draggable
                    onDragStart={(e) => {
                      setDragKey(l.key);
                      e.dataTransfer.setData("pos/line", l.key);
                      e.dataTransfer.effectAllowed = "move";
                      const card = e.currentTarget.closest("[data-line]");
                      if (card instanceof HTMLElement) e.dataTransfer.setDragImage(card, 24, 24);
                    }}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    className="shrink-0 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </button>
                  <span className={cn("font-medium text-sm line-clamp-2 break-words", outOfStock && "text-er")}>{l.product.name}</span>
                  {eff.pct > 0 && (
                    <span className={cn(
                      "shrink-0 text-xs font-bold rounded px-1",
                      l.manualPrice ? "text-primary-600 bg-primary-50 dark:bg-primary-950/40" : "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
                    )}>{eff.pct}</span>
                  )}
                  {m2 > 0 && <span className="shrink-0 text-xs text-primary-600">≈{m2.toFixed(1)}m²</span>}
                </div>
                <Select
                  value={l.unitName}
                  onChange={(e) => changeUnit(l.key, e.target.value)}
                  disabled={isCameraQuoteDraft}
                  size="sm"
                  options={[
                    { value: l.product.baseUnit, label: l.product.baseUnit },
                    ...l.product.units.map((u) => ({ value: u.unitName, label: u.unitName })),
                  ]}
                  className="min-w-20 shrink-0 font-medium text-slate-700 dark:text-slate-200"
                />
                <div className="group relative shrink-0">
                  <div
                    className={cn(
                      "grid h-8 w-28 grid-cols-[32px_1fr_32px] overflow-hidden rounded-md border border-border bg-surface",
                      outOfStock && "border-er text-er"
                    )}
                  >
                    <button
                      disabled={isCameraQuoteDraft}
                      onClick={() => updateQty(l.key, -1)}
                      className={cn(
                        "grid h-full place-items-center text-slate-500 hover:text-er hover:bg-surface-2",
                        outOfStock && "text-er hover:bg-red-50 dark:hover:bg-red-950/20"
                      )}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      value={l.quantity}
                      readOnly={isCameraQuoteDraft}
                      onChange={(e) => setQty(l.key, Number(e.target.value))}
                      className={cn(
                        "no-spinner h-full w-full border-x border-border bg-surface text-center text-sm outline-none",
                        outOfStock && "border-er text-er"
                      )}
                    />
                    <button
                      disabled={isCameraQuoteDraft}
                      onClick={() => updateQty(l.key, 1)}
                      className={cn(
                        "grid h-full place-items-center text-slate-500 hover:text-primary-600 hover:bg-surface-2",
                        outOfStock && "text-er hover:text-er hover:bg-red-50 dark:hover:bg-red-950/20"
                      )}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {isReturnDraft && l.returnSoldQuantity != null && (
                    <div className="mt-1 text-center text-xs font-medium tabular-nums text-slate-500">
                      / {formatNumber(l.returnSoldQuantity)}
                    </div>
                  )}
                  <StockQuantityTooltip stock={Number(l.product.stock)} ordered={l.quantity * l.unitMultiplier} unit={l.product.baseUnit} />
                </div>
                <button
                  disabled={isCameraQuoteDraft}
                  onClick={() => setEditKey(editKey === l.key ? null : l.key)}
                  title={t("pos.priceEditor.editHint")}
                  className="w-28 text-right text-base tabular-nums text-slate-500 hover:text-primary-600 shrink-0"
                >
                  {formatCurrency(eff.price)}
                </button>
                <span className="w-28 text-right text-base font-bold tabular-nums shrink-0">{formatCurrency(eff.price * l.quantity)}</span>
                <button disabled={isCameraQuoteDraft} onClick={() => setEditKey(editKey === l.key ? null : l.key)} className="w-7 h-7 rounded-md hover:bg-surface-2 grid place-items-center shrink-0 text-slate-400 disabled:cursor-not-allowed disabled:opacity-40">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 pb-2.5 -mt-1">
                <span className="w-5 shrink-0" />
                <span className="w-4 shrink-0" />
                <span className="w-24 shrink-0" />
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className="w-3.5 shrink-0" />
                  <input
                    type="text"
                    value={l.note ?? ""}
                    onChange={(e) => setLineNote(l.key, e.target.value)}
                    placeholder={t("pos.lineNotePlaceholder")}
                    className="min-w-0 flex-1 text-left text-xs text-slate-400 bg-transparent outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
                  />
                </div>
              </div>
              {editKey === l.key && (
                <LinePriceEditor
                  line={l}
                  onApply={(price, disc) => applyLinePrice(l.key, price, disc)}
                  onClose={() => setEditKey(null)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border p-2">
        <input
          type="text"
          value={orderNote ?? ""}
          onChange={(e) => setOrderNote(e.target.value)}
          placeholder={t("pos.orderNotePlaceholder")}
          className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface outline-none placeholder:text-slate-400"
        />
      </div>
    </div>
  );

  return (
    <div className="h-full flex relative">
      {/* trạng thái offline / đồng bộ */}
      {(!online || pending > 0 || syncing || offlineSaved) && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 text-xs font-medium">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
            !online ? "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300"
              : "bg-sky-100 text-sky-800 border border-sky-300 dark:bg-sky-950/70 dark:text-sky-300"
          )}>
            {!online ? <><WifiOff className="w-3.5 h-3.5" />{t("pos.offline.banner")}</>
              : syncing ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />{t("pos.offline.syncing")}</>
              : pending > 0 ? <><RefreshCw className="w-3.5 h-3.5" />{t("pos.offline.pending", { n: pending })}</>
              : <>{t("pos.offline.savedToast")}</>}
          </span>
        </div>
      )}

      {/* left: catalog */}
      <div className={cn("flex-1 flex flex-col p-3 sm:p-4 min-w-0 min-h-0 overflow-y-auto", mobileView === "cart" && "hidden lg:flex")}>
        {/* nút sang trang thanh toán — chỉ mobile */}
        {cart.length > 0 && (
          <button onClick={() => setMobileView("cart")}
            className="lg:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 px-5 py-3 rounded-full bg-primary-600 text-white font-semibold shadow-e2">
            <ShoppingCart className="w-4 h-4" /> {t("pos.checkout")} ({cart.reduce((s, l) => s + l.quantity, 0)}) · {formatCurrency(total)}
          </button>
        )}
        <div className="mb-3 space-y-2">
          {invoiceTabs}
          {showSourceInvoiceBanner && sourceInvoice && (
            <div className={cn(
              "grid gap-2 rounded-xl border p-3",
              isEditMode
                ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
                : "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20"
            )}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <Text
                    as="div"
                    weight="bold"
                    size="sm"
                    tx={sourceTitleTx}
                    txOptions={{ code: sourceInvoice.code }}
                  />
                  <Text
                    as="div"
                    variant="muted"
                    size="xs"
                    className="mt-0.5"
                    tx={sourceDescriptionTx}
                    txOptions={{ dateTime: sourceInvoice.saleTime ?? "—" }}
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={sourceInvoice.id ? Routes.salesOrder(sourceInvoice.id, sourceInvoice.kind === "quote" ? "quote" : sourceInvoice.kind === "booking" ? "confirmed" : "completed") : Routes.Sales}
                    target="_blank"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3 text-xs font-semibold text-slate-600")}
                  >
                    {t("pos.invoiceEdit.viewOriginal")}
                  </Link>
                </div>
              </div>
            </div>
          )}
          {aiUnresolvedItems.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <div className="text-xs font-bold uppercase tracking-wide">AI chưa tìm thấy sản phẩm trong danh mục active</div>
              <div className="mt-1 text-xs">
                Những dòng này chưa được thêm vào POS. Kiểm tra SKU/tên sản phẩm hoặc bật/tạo sản phẩm active trước khi bán.
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {aiUnresolvedItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSearch(item.sku ?? item.label)}
                    className="max-w-full rounded-full border border-amber-300 bg-white px-2.5 py-1 text-left text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30"
                    title={item.reason}
                  >
                    <span className="block max-w-[360px] truncate">
                      {item.sku ? `${item.sku} · ` : ""}{item.label} · SL {item.quantity}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {isCameraQuoteDraft && (
            <CameraQuotePanel
              products={searchableProducts}
              packages={cameraPackages}
              priceBook={priceBook}
              onChange={setCameraPackages}
            />
          )}
          {!isCameraQuoteDraft && <div ref={searchRef} className="relative flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setBrowsing(true)}
                placeholder={t("pos.searchPlaceholder")}
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-10"
              />
            </div>
            <AiQuickActionButton
              onClick={() => setAiQuickOpen(true)}
              label={t("aiQuick.pos.open")}
              className="h-[50px] w-12"
            />
            {showResults && (
              <button
                type="button"
                onClick={closeSearch}
                title={t("common.close")}
                className="absolute right-16 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-slate-600 lg:h-7 lg:w-7"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* dropdown kết quả nổi dưới ô tìm — giỏ hàng vẫn hiện phía sau */}
            {showResults && (
              <div className="absolute left-0 right-14 top-full z-40 mt-1 max-h-[min(64dvh,520px)] overflow-auto rounded-xl border border-border bg-surface shadow-e2">
                {searching ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t("common.search")}…</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-400">{search.trim() ? t("pos.noSearchResults") : t("pos.noProducts")}</div>
                ) : (
                  <div className="py-1">
                    {filtered.slice(0, 60).map((p) => {
                      const stock = Number(p.stock);
                      const line = cart.find((l) => l.product.id === p.id);
                      const children = productChildren(p);
                      return (
                        <div
                          key={p.id}
                          onClick={line ? undefined : () => selectProduct(p)}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-left",
                            line ? "bg-primary-50 dark:bg-primary-950/40" : "hover:bg-surface-2 cursor-pointer"
                          )}
                        >
                          <div className="w-9 h-9 rounded-md bg-surface-2 grid place-items-center text-lg shrink-0">{categoryEmoji(p.categoryName)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{p.name}</div>
                            <div className={cn("text-xs", stock <= 0 ? "text-er" : "text-slate-400")}>
                              {p.isVariantParent ? `${children.length} SKU con` : `${t("pos.stockLabel")} ${formatNumber(stock)} ${p.baseUnit}`}
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 w-auto sm:w-64 shrink-0">
                            {line && (
                              <div className="group relative flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => updateQty(line.key, -1)}
                                  className={cn(
                                    "w-8 h-8 rounded border border-border grid place-items-center",
                                    stock <= 0 && "border-er text-er"
                                  )}
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  value={line.quantity}
                                  onChange={(e) => setQty(line.key, Number(e.target.value))}
                                  className={cn(
                                    "no-spinner w-12 px-1 py-1 text-center text-sm rounded border border-border bg-surface",
                                    stock <= 0 && "border-er text-er"
                                  )}
                                />
                                <button
                                  onClick={() => updateQty(line.key, 1)}
                                  className={cn(
                                    "w-8 h-8 rounded border border-border grid place-items-center",
                                    stock <= 0 && "border-er text-er"
                                  )}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <StockQuantityTooltip stock={stock} ordered={line.quantity * line.unitMultiplier} unit={p.baseUnit} />
                              </div>
                            )}
                            <div className="text-sm font-semibold text-primary-600 tabular-nums text-right w-24 sm:w-32">
                              {priceLabelFor(p, priceBook)}{p.isVariantParent ? "" : `/${p.baseUnit}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>}
        </div>

        {!isCameraQuoteDraft && orderLinesPanel}
      </div>

      {/* right: cart — rộng hơn để thao tác đơn thoải mái, nhận thả SP từ danh sách */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("pos/product")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!dropHover) setDropHover(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false);
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("pos/product");
          setDropHover(false);
          if (!id) return;
          e.preventDefault();
          const p = searchableProducts.find((x) => x.id === id);
          if (p) selectProduct(p);
        }}
        className={cn(
          "w-full lg:w-[560px] shrink-0 bg-surface border-t lg:border-t-0 lg:border-l border-border flex flex-col transition-colors",
          mobileView === "catalog" && "hidden lg:flex",
          dropHover && "bg-primary-50/60 dark:bg-primary-950/30 border-l-primary-400"
        )}
      >
        {/* nút quay lại danh sách SP — chỉ mobile */}
        <button onClick={() => setMobileView("catalog")} className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-sm text-primary-600 border-b border-border">
          <X className="w-4 h-4" /> {t("pos.searchPlaceholder")}
        </button>
        {/* customer + bảng giá */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex gap-2">
            <div className="flex flex-1 min-w-0">
              <Combobox
                value={customerId}
                onChange={changeCustomer}
                placeholder={t("pos.walkInCustomer")}
                className="min-w-0 flex-1"
                options={customerOptions.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }))}
                actionLabel={t("customers.createNew")}
                actionIcon={<UserPlus className="h-4 w-4" />}
                onAction={() => setCustomerCreateOpen(true)}
              />
            </div>
            <Combobox
              value={priceBook || defaultBook?.id || ""}
              onChange={(id) => {
                const pb = data.priceBooks.find((book) => book.id === id);
                changePriceBook(!pb || pb.isDefault ? "" : pb.id);
              }}
              placeholder={t("pos.priceBook.title")}
              allowClear={false}
              showSearch={false}
              className={cn("w-48 shrink-0", !isDefaultBook && "[&_button]:border-primary-500 [&_button]:text-primary-700 dark:[&_button]:text-primary-300")}
              options={data.priceBooks.map((pb) => ({ value: pb.id, label: pb.name }))}
            />
          </div>
          {customer && Number(customer.currentDebt) > 0 && (
            <p className="text-xs text-warn">
              {t("pos.customerDebt", { debt: formatCurrency(Number(customer.currentDebt)) })}
            </p>
          )}
          {isReturnDraft && (
            <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{t(isReturnInvoiceDraft ? "pos.returns.invoiceTitle" : "pos.returns.quickTitle")}</div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={returnRestock ?? true}
                    onChange={(e) => setReturnRestock(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary-600"
                  />
                  {t("pos.returns.restock")}
                </label>
              </div>
              {isReturnInvoiceDraft && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={returnOrderCode ? `${returnOrderCode}${returnSourceQuery ? ` · ${returnSourceQuery}` : ""}` : returnSourceQuery}
                    onChange={(e) => {
                      setReturnSourceOrder(null);
                      setReturnSourceQuery(e.target.value);
                    }}
                    placeholder={t("pos.returns.sourcePlaceholder")}
                    className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm"
                  />
                  {(returnSourceSearching || returnSourceOptions.length > 0) && !returnOrderId && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-e2">
                      {returnSourceSearching ? (
                        <div className="px-3 py-3 text-sm text-slate-400"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{t("common.search")}</div>
                      ) : (
                        returnSourceOptions.map((order) => (
                          <button
                            key={order.id}
                            type="button"
                            onClick={() => {
                              setReturnSourceOrder(order);
                              setReturnSourceQuery("");
                              setReturnSourceOptions([]);
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"
                          >
                            <span className="min-w-0">
                              <span className="font-semibold text-primary-600">{order.code}</span>
                              <span className="ml-2 text-slate-500">{order.customerName ?? t("orders.walkIn")}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-slate-500">{formatCurrency(Number(order.total))}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={returnReason ?? "other"}
                  onChange={(e) => setReturnReason(e.target.value)}
                  size="sm"
                  options={[
                    { value: "defective", label: t("returns.reasons.defective") },
                    { value: "wrong_item", label: t("returns.reasons.wrong_item") },
                    { value: "changed_mind", label: t("returns.reasons.changed_mind") },
                    { value: "other", label: t("returns.reasons.other") },
                  ]}
                />
                <div className="text-xs leading-8 text-slate-500">
                  {isReturnInvoiceDraft
                    ? returnOrderCode ? t("pos.returns.sourceSelected", { code: returnOrderCode }) : t("pos.returns.sourceHint")
                    : t("pos.returns.quickHint")}
                </div>
              </div>
            </div>
          )}
          {posPrefs.showProjectFields && !isReturnDraft && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Combobox
                  value={projectId}
                  onChange={(id) => { setProjectId(id); const pj = data.projects.find((p) => p.id === id); if (pj) setProjectName(pj.name); }}
                  placeholder={t("pos.noProject")}
                  options={data.projects.filter((p) => !customerId || !p.customerId || p.customerId === customerId).map((p) => ({ value: p.id, label: p.name }))}
                />
              </div>
              <input
                value={projectName}
                onChange={(e) => { setProjectName(e.target.value); setProjectId(""); }}
                placeholder={t("pos.projectPlaceholder")}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-surface"
              />
            </div>
          )}
          {isBookingDraft && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">{t("pos.deliveryTime")}</label>
              <input
                type="datetime-local"
                value={deliveryDate ?? ""}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        {/* totals + payment — đẩy lên ngay dưới khách hàng */}
        <div className="p-3 border-t border-border space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">{t("pos.subtotal")}</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          {!isReturnDraft && (
            <>
              <SummaryAdjustRow
                label={t("pos.discount")}
                hint={`− ${formatCurrency(discountVnd)}`}
                hintVisible={discountMode === "pct" && discountInput > 0}
              >
                <AmountModeInput
                  value={discountInput}
                  mode={discountMode}
                  onValueChange={setDiscountInput}
                  onModeChange={setDiscountMode}
                />
              </SummaryAdjustRow>
              <SummaryAdjustRow
                label={t("pos.tax")}
                hint={`+ ${formatCurrency(taxAmount)}`}
                hintVisible={taxRate > 0}
              >
                <AmountModeInput value={taxRate} mode="pct" onValueChange={setTaxRate} />
              </SummaryAdjustRow>
              <SummaryAdjustRow label={t("pos.shipping")}>
                <AmountModeInput value={shippingFee} mode="vnd" onValueChange={setShippingFee} />
              </SummaryAdjustRow>
            </>
          )}
          <div className="flex justify-between text-base font-semibold pt-1">
            <span>{t(isReturnDraft ? "returns.totalRefund" : "pos.total")}</span>
            <span className="text-primary-600 tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* phương thức + nút — ghim đáy panel */}
        <div className="p-3 border-t border-border space-y-2 text-sm">
          {isReturnDraft ? (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {(["cash", "bank_transfer", "credit"] as PayMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={cn(
                      "py-1.5 rounded-lg text-xs font-medium border",
                      payMethod === m
                        ? "bg-primary-600 text-white border-primary-600"
                        : "border-border text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {t(m === "credit" ? "returns.refundMethods.debt_deduct" : `returns.refundMethods.${m}`)}
                  </button>
                ))}
              </div>
              <div className="flex justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
                <span className="text-slate-500">{t("returns.totalRefund")}</span>
                <span className="font-semibold tabular-nums text-er">{formatCurrency(total)}</span>
              </div>
            </>
          ) : isInvoiceDraft ? (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {(["cash", "bank_transfer", "credit"] as PayMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={cn(
                      "py-1.5 rounded-lg text-xs font-medium border",
                      payMethod === m
                        ? "bg-primary-600 text-white border-primary-600"
                        : "border-border text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {t(`pos.payMethods.${m}`)}
                  </button>
                ))}
              </div>

              {/* hàng "khách trả" luôn render để không nhảy layout khi đổi ghi nợ */}
              <div className="flex justify-between items-center gap-2">
                <span className="text-slate-500">
                  {payMethod === "credit" ? t("pos.payMethods.credit") : t("pos.paidAmount")}
                </span>
                {payMethod !== "credit" ? (
                  <MoneyInput
                    value={paidInput ?? total}
                    onChange={(v) => setPaidInput(v ?? 0)}
                    className="no-spinner w-36 px-2 py-1 text-right text-sm rounded-md border border-border bg-surface"
                  />
                ) : (
                  <span className="w-36 px-2 py-1 text-right text-sm font-semibold text-warn tabular-nums border border-transparent">
                    {formatCurrency(total)}
                  </span>
                )}
              </div>
              {payMethod !== "credit" && remaining > 0 && (
                <p className="text-xs text-warn text-right">
                  {t("pos.willOweAmount", { amount: formatCurrency(remaining) })}
                </p>
              )}
            </>
          ) : (
            <div className="flex justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="text-slate-500">{t(isQuoteDraft ? "pos.quoteAmount" : "pos.customerDue")}</span>
              <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">{t("pos.defaultPrintTemplate")}</span>
            <PrintSizePicker
              value={printDefaultSize}
              options={[
                { value: "a4", label: t("pos.printA4Short") },
                { value: "a5", label: t("pos.printA5Short") },
                { value: "k80", label: t("pos.printK80Short") },
              ]}
              onChange={changePrintDefaultSize}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <div className="relative">
              <button
                disabled={(isReturnDraft ? !hasReturnQuantity : cart.length === 0) || submitting}
                onClick={() => doPrint(printDefaultSize)}
                title={t("pos.printSlip")}
                className="h-full px-3 py-3 rounded-xl border border-border text-sm font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {t("pos.printSlip")}
              </button>
            </div>
            <button
              disabled={(isReturnDraft ? !hasReturnQuantity : cart.length === 0) || submitting || !data.warehouse || !!sepayCheckout}
              onClick={submitActiveDraft}
              className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
            >
              {submittingMode !== null && <Loader2 className="w-4 h-4 animate-spin" />}
              {sourcePrimaryLabel
                ? sourcePrimaryLabel
                  : isQuoteDraft
                    ? t("pos.saveQuote")
                    : isBookingDraft
                      ? t("pos.placeBooking")
                      : isReturnDraft
                        ? t("returns.submit")
                      : t("pos.checkout")} · {formatCurrency(total)}
            </button>
          </div>
          {isEditMode && (
            <Text as="p" variant="muted" className="text-[11px] text-right" tx="pos.invoiceEdit.editFootnote" />
          )}
        </div>
      </div>

      <AiQuickActionModal
        open={aiQuickOpen}
        title={t("aiQuick.pos.title")}
        description={t("aiQuick.pos.description")}
        placeholder={t("aiQuick.pos.placeholder")}
        submitLabel={t("aiQuick.pos.submit")}
        applyLabel={t("aiQuick.pos.apply")}
        preset="pos_voice_cart_draft"
        surface="pos"
        acceptedIntents={["pos_voice_cart_draft", "pos_image_cart_draft"]}
        hasExistingData={false}
        existingDataLabel={t("aiQuick.pos.existingData")}
        onClose={() => setAiQuickOpen(false)}
        onApply={applyAiCartPreview}
      />
      <CustomerCreateDialog
        open={customerCreateOpen}
        onOpenChange={setCustomerCreateOpen}
        onCreated={applyCreatedCustomer}
      />
      {sepayCheckout && (
        <SepayCheckoutModal
          checkout={sepayCheckout}
          onClose={() => {
            setSepayCheckout(null);
          }}
        />
      )}

      {/* Modal chọn bảng giá áp cho đơn đang mở */}
      {variantParent && (
        <VariantPickerModal
          parent={variantParent}
          priceBook={priceBook}
          onClose={() => setVariantParent(null)}
          onSelect={(child) => {
            addToCart(child);
            setVariantParent(null);
            closeSearch();
          }}
        />
      )}

      {addMenuOpen && addMenuPosition && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
          <div
            className="fixed z-50 min-w-[190px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-e2"
            style={{ top: addMenuPosition.top, left: addMenuPosition.left }}
          >
            {(["invoice", "quote", "booking", "return_quick"] as PosDraftKind[]).map((kind) => {
              const ItemIcon = isReturnKind(kind) ? RotateCcw : kind === "quote" ? FileText : kind === "booking" ? ClipboardList : ShoppingCart;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => addDraft(kind)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <ItemIcon className="h-4 w-4 text-slate-400" />
                  {t(`pos.draftTabs.add.${kind}`)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => addDraft("quote", true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <FileText className="h-4 w-4 text-primary-500" />
              {t("pos.draftTabs.add.cameraQuote")}
            </button>
          </div>
        </>,
        document.body
      )}

      {/* Phiếu tạm để in (ẩn trên màn hình, chỉ hiện khi in) */}
      {printSize && printJob && createPortal(
        <div className="pos-print-root">
          <PrintDoc
            template={printJob.template}
            size={printSize}
            title={printJob.title}
            code={printJob.code}
            date={printJob.date}
            partyLabel={t("orders.cols.customer")}
            partyName={printJob.partyName}
            partyPhone={printJob.partyPhone}
            projectName={printJob.projectName || null}
            sellerLabel={t("orders.detail.seller")}
            items={printJob.items.map((l) => {
              const e = effPrice(l);
              const lineDiscount = Math.max(0, (l.unitPrice - e.price) * l.quantity);
              return { id: l.key, name: l.product.name, unitName: l.unitName, quantity: l.quantity, unitPrice: l.unitPrice, discount: lineDiscount, total: e.price * l.quantity };
            })}
            totals={[
              { label: t("pos.subtotal"), value: printJob.totals.subtotal, kind: "subtotal" },
              ...(printJob.totals.discount > 0 ? [{ label: t("pos.discount"), value: printJob.totals.discount, negative: true, kind: "discount" as const }] : []),
              ...(printJob.totals.tax > 0 ? [{ label: t("pos.tax"), value: printJob.totals.tax, kind: "tax" as const }] : []),
              ...(printJob.totals.shipping > 0 ? [{ label: t("pos.shipping"), value: printJob.totals.shipping, kind: "shipping" as const }] : []),
            ]}
            grandTotalLabel={t(printJob.template.docType === "return" ? "returns.totalRefund" : "print.grandTotal")}
            grandTotal={printJob.grandTotal}
            paymentQr={printJob.paymentQr}
            afterTotals={printJob.template.options.showDebt && printJob.payMethod !== "credit" && printJob.paid > 0
              ? [
                  { label: t("print.paid"), value: printJob.paid },
                  ...(printJob.remaining > 0 ? [{ label: t("print.remaining"), value: printJob.remaining, bold: true }] : []),
                ]
              : []}
            inWordsLabel={t("print.inWords")}
            signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
            signHint={t("print.signHint")}
            cols={{
              product: t("orders.cols.product"),
              unit: t("orders.cols.unit"),
              qty: t(printJob.template.docType === "return" ? "returns.cols.returnNow" : "orders.cols.qty"),
              unitPrice: t("orders.cols.unitPrice"),
              discount: t("orders.cols.discount"),
              lineTotal: t("orders.cols.lineTotal"),
            }}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

function SepayCheckoutModal({ checkout, onClose }: { checkout: SepayCheckout; onClose: () => void }) {
  const t = useTranslations();
  const confirmed = ["confirmed", "reconciled", "manual_confirmed"].includes(checkout.status);
  return (
    <>
      <div className="fixed inset-0 z-[90] bg-slate-950/45" />
      <div className="fixed inset-x-3 top-1/2 z-[100] mx-auto max-w-md -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-e2 sm:inset-x-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-bold">{t("pos.sepay.title")}</div>
            <div className="mt-0.5 text-xs text-slate-500">{checkout.orderCode} · {formatCurrency(checkout.amount)}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div className="mx-auto grid w-56 place-items-center rounded-xl border border-border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkout.qrImageUrl} alt={t("pos.sepay.qrAlt")} className="h-52 w-52 object-contain" />
          </div>
          <div className="rounded-xl border border-border bg-canvas p-3 text-xs">
            <div className="flex justify-between gap-3 py-1"><span className="text-slate-500">{t("pos.sepay.bank")}</span><span className="font-semibold text-right">{checkout.bankAccount.gateway ?? checkout.bankAccount.bankCode}</span></div>
            <div className="flex justify-between gap-3 py-1"><span className="text-slate-500">{t("pos.sepay.account")}</span><span className="font-mono font-semibold text-right">{checkout.bankAccount.accountNumber}</span></div>
            <div className="flex justify-between gap-3 py-1"><span className="text-slate-500">{t("pos.sepay.name")}</span><span className="font-semibold text-right">{checkout.bankAccount.accountName}</span></div>
            <div className="flex justify-between gap-3 py-1"><span className="text-slate-500">{t("pos.sepay.reference")}</span><span className="font-mono font-semibold text-right">{checkout.reference}</span></div>
          </div>
          <div className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
            confirmed ? "bg-ok-soft text-ok" : "bg-in-soft text-in"
          )}>
            {confirmed ? <CheckCircle2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{confirmed ? t("pos.sepay.confirmed") : t("pos.sepay.waiting")}</span>
          </div>
          <button type="button" onClick={onClose} className="w-full rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
            {t("pos.sepay.viewOrder")}
          </button>
        </div>
      </div>
    </>
  );
}

function VariantPickerModal({
  parent,
  priceBook,
  onSelect,
  onClose,
}: {
  parent: PosProduct;
  priceBook: PriceBook;
  onSelect: (product: PosProduct) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const children = productChildren(parent);

  return (
    <>
      <div className="fixed inset-0 z-55 bg-slate-950/30" onClick={onClose} />
      <div className="fixed z-60 left-1/2 top-1/2 w-[560px] max-w-[calc(100vw-32px)] max-h-[min(80dvh,640px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-e2">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{parent.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">{children.length} SKU con · {priceLabelFor(parent, priceBook)}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(min(80dvh,640px)-64px)] overflow-auto p-2">
          {children.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">{t("pos.noProducts")}</div>
          ) : (
            <div className="grid gap-2">
              {children.map((child) => {
                const stock = Number(child.stock);
                return (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => onSelect(child)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left hover:border-primary-300 hover:bg-primary-50/50 dark:hover:bg-primary-950/20"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{child.variantName ?? child.name}</span>
                      <span className="block text-xs text-slate-500">{child.sku}{child.barcode ? ` · ${child.barcode}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold text-primary-600 tabular-nums">{formatCurrency(basePriceFor(child, priceBook))}</span>
                      <span className={cn("block text-xs", stock <= 0 ? "text-er" : "text-slate-500")}>{formatNumber(stock)} {child.baseUnit}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SummaryAdjustRow({
  label,
  hint,
  hintVisible = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  hintVisible?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,184px)] items-start gap-2">
      <Text as="span" variant="muted" className="pt-2.5" text={label} />
      <div className="grid justify-items-end gap-1">
        {children}
        <Text
          as="div"
          variant="muted"
          size="xs"
          aria-hidden={!hintVisible}
          className={cn(
            "h-4 tabular-nums transition-opacity duration-150",
            hintVisible ? "opacity-100" : "opacity-0"
          )}
        >
          {hint ?? "\u00a0"}
        </Text>
      </div>
    </div>
  );
}

function StockQuantityTooltip({ stock, ordered, unit }: { stock: number; ordered: number; unit: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-[80] mt-2 min-w-34 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-slate-800 opacity-0 shadow-e2 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:text-slate-100">
      <div>{`Tồn: ${formatNumber(stock)} ${unit}`}</div>
      <div>{`Đặt: ${formatNumber(ordered)} ${unit}`}</div>
    </div>
  );
}

function PrintSizePicker({
  value,
  options,
  onChange,
}: {
  value: PaperSize;
  options: { value: PaperSize; label: string }[];
  onChange: (value: PaperSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-28">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-xs font-semibold",
          "transition hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
        )}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full right-0 z-50 mb-1 w-32 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-e2"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-surface-2",
                  active && "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                )}
              >
                <span>{option.label}</span>
                {active && <CheckCircle2 className="h-4 w-4 text-primary-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AmountModeInput({
  value,
  mode,
  onValueChange,
  onModeChange,
  className,
}: {
  value: number;
  mode: "vnd" | "pct";
  onValueChange: (value: number) => void;
  onModeChange?: (mode: "vnd" | "pct") => void;
  className?: string;
}) {
  const shown = value || "";
  return (
    <div className={cn(
      "w-full max-w-[184px] h-11 grid grid-cols-[1fr_56px] rounded-lg border border-border bg-surface overflow-hidden",
      className
    )}>
      {mode === "pct" ? (
        <input
          type="number"
          min={0}
          max={100}
          value={shown}
          onChange={(e) => onValueChange(Math.max(0, Number(e.target.value)))}
          placeholder="0"
          className="no-spinner h-full min-w-0 px-3 text-right text-sm tabular-nums bg-transparent outline-none"
        />
      ) : (
        <MoneyInput
          value={shown}
          onChange={(v) => onValueChange(v ?? 0)}
          placeholder="0"
          className="no-spinner h-full min-w-0 px-3 text-right text-sm tabular-nums bg-transparent outline-none border-0"
        />
      )}
      {onModeChange ? (
        <Button
          type="button"
          onClick={() => onModeChange(mode === "vnd" ? "pct" : "vnd")}
          variant="ghost"
          size="default"
          className="h-full rounded-none border-l border-border text-sm font-semibold text-slate-600 hover:text-primary-700 hover:bg-primary-50 dark:hover:bg-primary-950/30"
        >
          {mode === "vnd" ? "đ" : "%"}
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </Button>
      ) : (
        <Text as="span" variant="muted" weight="semibold" className="border-l border-border text-sm grid place-items-center">
          {mode === "vnd" ? "đ" : "%"}
        </Text>
      )}
    </div>
  );
}

/** Popup sửa đơn giá + giảm giá (VND/%) cho 1 dòng — giống KiotViet. */
function LinePriceEditor({
  line, onApply, onClose,
}: {
  line: CartLine;
  onApply: (unitPrice: number, lineDiscount: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [price, setPrice] = useState(String(line.unitPrice));
  const [discMode, setDiscMode] = useState<"vnd" | "pct">("vnd");
  // khởi tạo ô giảm giá theo VND hiện có
  const [disc, setDisc] = useState(String(line.lineDiscount ?? 0));

  const priceNum = Math.max(0, Number(price) || 0);
  const discNum = Math.max(0, Number(disc) || 0);
  const discVnd = discMode === "pct" ? Math.round((priceNum * discNum) / 100) : discNum;
  const sell = Math.max(0, priceNum - discVnd);

  function apply() {
    onApply(priceNum, discVnd);
  }

  return (
    <>
      {/* lớp nền để click ra ngoài đóng popup */}
      <div className="fixed inset-0 z-55" onClick={onClose} />
      <div className="fixed z-60 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-100 max-w-[calc(100vw-32px)] bg-surface rounded-xl border border-border shadow-e2 p-4 space-y-3 text-sm">
        <div className="font-semibold text-base mb-1">{line.product.name}</div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 shrink-0">{t("pos.priceEditor.unitPrice")}</span>
          <MoneyInput
            value={price} autoFocus
            onChange={(v) => setPrice(v == null ? "" : String(v))}
            className="no-spinner w-40 px-2 py-1.5 text-right rounded-md border border-border bg-surface"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 shrink-0">{t("pos.priceEditor.discount")}</span>
          <AmountModeInput
            value={discNum}
            mode={discMode}
            onValueChange={(v) => setDisc(String(v))}
            onModeChange={setDiscMode}
          />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
          <span className="text-slate-500 shrink-0">{t("pos.priceEditor.sellPrice")}</span>
          <span className="font-bold text-primary-600 tabular-nums">{formatCurrency(sell)}</span>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-slate-600 dark:text-slate-300 font-medium">
            {t("common.cancel")}
          </button>
          <button onClick={apply} className="flex-1 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold">
            {t("common.apply")}
          </button>
        </div>
      </div>
    </>
  );
}
