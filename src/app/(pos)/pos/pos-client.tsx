"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Plus, Minus, Trash2, Loader2, ShoppingCart, X, GripVertical, WifiOff, RefreshCw, Tag, ChevronDown, Check, Printer, MoreVertical } from "lucide-react";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/normalize";
import { createPortal } from "react-dom";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { MoneyInput } from "@/components/ui/money-input";
import { Text } from "@/components/ui/text";
import { PrintDoc } from "@/components/print/print-doc";
import type { PaperSize, PrintTemplate } from "@/lib/print/template-shared";
import { createOrder } from "@/lib/actions/orders";
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
  lineDiscount?: number;  // giảm giá tay (VND) trên mỗi đơn vị
  manualPrice?: boolean;  // đã sửa giá/giảm giá tay → bỏ qua KM tự động
  note?: string;
};

type PayMethod = "cash" | "bank_transfer" | "credit";
export type PosSourceInvoice = {
  id?: string;
  mode: "edit" | "copy";
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

/**
 * Một hóa đơn đang soạn (tab). Cho phép mở nhiều đơn cùng lúc — bán cho nhiều
 * khách song song mà không mất giỏ (giống KiotViet/Sapo). Lưu localStorage.
 */
/** Bảng giá áp cho hóa đơn = id bảng giá ("" = bảng giá mặc định/giá lẻ). */
export type PriceBook = string;

interface Invoice {
  id: string;
  cart: CartLine[];
  customerId: string;
  projectId: string;
  projectName: string;
  priceBook: PriceBook;
  discountInput: number;
  discountMode: "vnd" | "pct";
  taxRate: number;
  shippingFee: number;
  payMethod: PayMethod;
  paidInput: number | null;
  note?: string;
}

const INV_KEY = "pos-invoices";
const ACT_KEY = "pos-active-invoice";
const FIRST_INV_ID = "inv-1"; // id ổn định cho SSR (tránh hydration mismatch)

/** Đơn rỗng. id truyền vào để lần đầu dùng id cố định, các tab sau dùng Date.now. */
function makeInvoice(id?: string): Invoice {
  return {
    id: id ?? `inv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    cart: [], customerId: "", projectId: "", projectName: "", priceBook: "",
    discountInput: 0, discountMode: "vnd", taxRate: 0,
    shippingFee: 0, payMethod: "cash", paidInput: null,
  };
}

function makeInvoiceFromSource(source: PosSourceInvoice, products: PosProduct[], id = FIRST_INV_ID): Invoice {
  const afterDiscount = Math.max(0, (source.subtotal ?? 0) - (source.discount ?? 0));
  const taxRate = afterDiscount > 0 && source.tax ? Math.round(((source.tax / afterDiscount) * 100) * 100) / 100 : 0;
  return {
    ...makeInvoice(id),
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

function normalizeInvoice(raw: Record<string, unknown>): Invoice {
  const base = makeInvoice(raw.id as string | undefined);
  return {
    ...base,
    ...(raw as Partial<Invoice>),
    discountInput: (raw.discountInput as number | undefined) ?? (raw.discount as number | undefined) ?? 0,
    discountMode: (raw.discountMode as "vnd" | "pct" | undefined) ?? "vnd",
    taxRate: (raw.taxRate as number | undefined) ?? 0,
  };
}

function loadInvoices(): Invoice[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(INV_KEY) ?? "null") as Record<string, unknown>[] | null;
    if (!raw || raw.length === 0) return null;
    return raw.map(normalizeInvoice);
  } catch {
    return null;
  }
}

function saveInvoices(list: Invoice[]) {
  try {
    localStorage.setItem(INV_KEY, JSON.stringify(list));
  } catch { /* đầy quota — bỏ qua */ }
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

function currentTimestamp(): number {
  return Date.now();
}

export function PosClient({
  data,
  printTemplate,
  initialSourceInvoice,
}: {
  data: PosData;
  printTemplate: PrintTemplate;
  initialSourceInvoice?: PosSourceInvoice | null;
}) {
  const t = useTranslations();
  const router = useRouter();

  const [sourceInvoice] = useState<PosSourceInvoice | null>(initialSourceInvoice ?? null);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // kéo thả: sắp xếp dòng trong giỏ + thả SP từ danh sách vào giỏ
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [mobileView, setMobileView] = useState<"catalog" | "cart">("catalog"); // chuyển đổi trên mobile
  const [priceBookOpen, setPriceBookOpen] = useState(false); // modal chọn bảng giá
  const [variantParent, setVariantParent] = useState<PosProduct | null>(null);
  const [browsing, setBrowsing] = useState(false); // click vào ô tìm → mở dropdown SP
  const searchRef = useRef<HTMLDivElement>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false); // chọn khổ in
  const [printSize, setPrintSize] = useState<PaperSize | null>(null); // đang in phiếu tạm
  const [printCode, setPrintCode] = useState("");
  const [printDate, setPrintDate] = useState("");
  // In phiếu tạm: ẩn app, chỉ hiện phiếu, gọi in trình duyệt rồi khôi phục.
  useEffect(() => {
    if (!printSize) return;
    document.body.classList.add("pos-printing");
    const restore = () => { document.body.classList.remove("pos-printing"); setPrintSize(null); };
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
  const [invoices, setInvoices] = useState<Invoice[]>(() => [
    initialSourceInvoice ? makeInvoiceFromSource(initialSourceInvoice, data.products, FIRST_INV_ID) : makeInvoice(FIRST_INV_ID),
  ]);
  const [activeId, setActiveId] = useState(FIRST_INV_ID);

  // load đơn đang soạn sau khi mount (tránh lệch SSR; defer cho react-compiler)
  useEffect(() => {
    if (sourceInvoice) return;
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
  }, [sourceInvoice]);

  // ghi localStorage mỗi khi đơn đổi (bỏ qua lần đầu để không ghi đè bản đã lưu)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (sourceInvoice) return;
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    saveInvoices(invoices);
  }, [invoices, sourceInvoice]);

  // nhớ tab đang mở (giữ khi chuyển trang rồi quay lại)
  useEffect(() => {
    if (!sourceInvoice && hydratedRef.current) {
      try { localStorage.setItem(ACT_KEY, activeId); } catch { /* bỏ qua */ }
    }
  }, [activeId, sourceInvoice]);

  const active = invoices.find((i) => i.id === activeId) ?? invoices[0];
  const { cart, customerId, projectId, projectName, discountInput, discountMode, taxRate, shippingFee, payMethod, paidInput, note: orderNote } = active;
  const priceBook: PriceBook = active.priceBook ?? ""; // "" = bảng giá mặc định
  const defaultBook = data.priceBooks.find((b) => b.isDefault) ?? data.priceBooks[0];
  const priceBookName = (priceBook && data.priceBooks.find((b) => b.id === priceBook)?.name) || defaultBook?.name || "Giá lẻ";
  const isDefaultBook = !priceBook || priceBook === defaultBook?.id;

  /** Patch hóa đơn đang mở (nhận object hoặc hàm cập nhật). */
  function patchActive(patch: Partial<Invoice> | ((inv: Invoice) => Partial<Invoice>)) {
    setInvoices((list) =>
      list.map((inv) => (inv.id === activeId ? { ...inv, ...(typeof patch === "function" ? patch(inv) : patch) } : inv))
    );
  }
  // setter giữ nguyên chữ ký cũ để JSX bên dưới không phải đổi
  const setCart = (v: CartLine[] | ((c: CartLine[]) => CartLine[])) =>
    patchActive((inv) => ({ cart: typeof v === "function" ? v(inv.cart) : v }));
  const setProjectId = (v: string) => patchActive({ projectId: v });
  const setProjectName = (v: string) => patchActive({ projectName: v });
  const setDiscountInput = (v: number) => patchActive({ discountInput: v });
  const setDiscountMode = (v: "vnd" | "pct") => patchActive({ discountMode: v });
  const setTaxRate = (v: number) => patchActive({ taxRate: v });
  const setShippingFee = (v: number) => patchActive({ shippingFee: v });
  const setOrderNote = (v: string) => patchActive({ note: v });
  const setPayMethod = (v: PayMethod) => patchActive({ payMethod: v });
  const setPaidInput = (v: number | null) => patchActive({ paidInput: v });

  /** Thêm tab hóa đơn mới và chuyển sang nó. */
  function addInvoice() {
    const inv = makeInvoice();
    setInvoices((list) => [...list, inv]);
    setActiveId(inv.id);
    setError("");
  }

  /** Đóng 1 tab; luôn giữ tối thiểu 1 đơn. */
  function closeInvoice(id: string) {
    setInvoices((list) => {
      const next = list.filter((i) => i.id !== id);
      const final = next.length > 0 ? next : [makeInvoice()];
      if (id === activeId) setActiveId(final[Math.max(0, list.findIndex((i) => i.id === id) - 1)]?.id ?? final[0].id);
      return final;
    });
  }

  const customer = useMemo(
    () => data.customers.find((c) => c.id === customerId) ?? null,
    [customerId, data.customers]
  );
  const searchableProducts = useMemo(() => flattenProducts(data.products), [data.products]);

  // Khi gõ tìm kiếm: hỏi server (quét toàn bộ SP, bỏ dấu) — khớp trang Sản phẩm.
  const [serverResults, setServerResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  // ===== offline (Mức A) =====
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);

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
      saveCatalog({ products: data.products, customers: data.customers, savedAt: Date.now() });
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
  const discountVnd = discountMode === "pct" ? Math.round(subtotal * discountInput / 100) : discountInput;
  const taxAmount = Math.round((subtotal - discountVnd) * taxRate / 100);
  const total = Math.max(0, subtotal - discountVnd + taxAmount + shippingFee);
  const paid = payMethod === "credit" ? 0 : (paidInput ?? total);
  const remaining = Math.max(0, total - paid);

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
      c.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function setQty(key: string, qty: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, qty) } : l)).filter((l) => l.quantity > 0));
  }

  async function submitOrder(mode: "sale" | "quote") {
    if (cart.length === 0 || !data.warehouse || submitting) return;
    if (mode === "sale" && payMethod === "credit" && !customerId) {
      setError(t("pos.errors.creditNeedsCustomer"));
      return;
    }
    if (sourceInvoice && mode === "quote") {
      setError(t("pos.invoiceEdit.saleOnly"));
      return;
    }
    if (sourceInvoice && typeof navigator !== "undefined" && !navigator.onLine) {
      setError(t("pos.invoiceEdit.onlineRequired"));
      return;
    }
    const payload = {
      mode,
      clientId: makeClientId(), // khử trùng khi đồng bộ offline
      source: sourceInvoice?.id ? { mode: sourceInvoice.mode, orderId: sourceInvoice.id } : undefined,
      customerId: customerId || null,
      warehouseId: data.warehouse.id,
      projectId: projectId || null,
      projectName: projectName || undefined,
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
      payment: { method: payMethod, amount: mode === "quote" ? 0 : paid },
    };
    setSubmitting(true);
    setError("");

    // offline → xếp hàng chờ đồng bộ
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueOffline(payload);
      return;
    }
    try {
      const res = await createOrder(payload);
      setSubmitting(false);
      if (res.ok) {
        closeInvoice(activeId);
        router.push(mode === "quote" ? Routes.Quotes : Routes.order(res.data.id));
      } else {
        setError(t(res.error));
      }
    } catch {
      // mất mạng giữa chừng → xếp hàng offline
      await queueOffline(payload);
    }
  }

  /** Lưu đơn vào hàng đợi offline + báo người dùng. */
  async function queueOffline(payload: Parameters<typeof createOrder>[0]) {
    // localId = clientId của đơn → sync lại dùng đúng clientId, server khử trùng.
    await enqueueOrder({ localId: payload.clientId ?? makeClientId(), payload, savedAt: currentTimestamp() });
    setSubmitting(false);
    setPending((c) => c + 1);
    closeInvoice(activeId);
    setOfflineSaved(true);
    setTimeout(() => setOfflineSaved(false), 3500);
  }
  const checkout = () => submitOrder("sale");

  /** Mở in phiếu tạm theo khổ đã chọn. */
  const doPrint = (size: PaperSize) => {
    setPrintCode(makeTempSlipCode());
    setPrintDate(new Date().toISOString());
    setPrintMenuOpen(false);
    setPrintSize(size);
  };

  // Khu chính hiện lưới SP khi đang tìm hoặc khi bấm vào ô tìm; ngược lại hiện dòng hàng đã chọn.
  const showResults = browsing || search.trim() !== "";
  const closeSearch = () => { setBrowsing(false); setSearch(""); };
  const isEditMode = sourceInvoice?.mode === "edit";
  const isCopyMode = sourceInvoice?.mode === "copy";

  // Tabs hóa đơn — đặt cạnh thanh tìm kiếm (giống KiotViet).
  const invoiceTabs = (
    <div className="flex items-stretch gap-1.5 overflow-x-auto">
      {invoices.map((inv, idx) => {
        const count = inv.cart.reduce((s, l) => s + l.quantity, 0);
        const isActive = inv.id === activeId;
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
            <ShoppingCart className={cn("w-4 h-4 shrink-0", isActive ? "text-primary-600" : "text-slate-400")} />
            <span>{t("pos.invoice.tab", { n: idx + 1 })}</span>
            {count > 0 && (
              <span className={cn(
                "min-w-[20px] text-center rounded-full px-1.5 text-xs font-bold",
                isActive ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300" : "bg-slate-200 dark:bg-slate-700"
              )}>{count}</span>
            )}
            {invoices.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeInvoice(inv.id); }}
                className="p-0.5 rounded text-slate-400 hover:text-er hover:bg-slate-200/70 dark:hover:bg-slate-700"
                title={t("pos.invoice.close")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={addInvoice}
        title={t("pos.invoice.add")}
        className="shrink-0 px-3 py-2.5 rounded-lg border border-border text-slate-400 hover:text-primary-600 hover:border-primary-300"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );

  // Danh sách dòng hàng đã chọn — hiển thị ở khu chính (giống KiotViet).
  const orderLinesPanel = (
    <div className="flex-1 flex flex-col min-h-0 border border-border rounded-xl bg-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <h2 className="font-semibold text-sm">{t("pos.order")} ({cart.length})</h2>
      </div>
      <div className="flex-1 overflow-auto">
        {cart.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-12">{t("pos.noItems")}</div>
        )}
        {cart.map((l, idx) => {
          const m2 = l.product.m2PerUnit ? Number(l.product.m2PerUnit) * l.unitMultiplier * l.quantity : 0;
          const eff = effPrice(l);
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
                dragKey === l.key && "opacity-50",
                overKey === l.key && dragKey && dragKey !== l.key && "bg-primary-50/40 dark:bg-primary-950/20"
              )}
            >
              <div className="flex items-center gap-2 px-3 py-3">
                <span className="w-5 text-center text-xs text-slate-400 shrink-0 tabular-nums">{idx + 1}</span>
                <button onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} className="text-slate-400 hover:text-er shrink-0">
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
                  <span className="font-medium text-sm line-clamp-2 break-words">{l.product.name}</span>
                  {eff.pct > 0 && (
                    <span className={cn(
                      "shrink-0 text-xs font-bold rounded px-1",
                      l.manualPrice ? "text-primary-600 bg-primary-50 dark:bg-primary-950/40" : "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
                    )}>{eff.pct}</span>
                  )}
                  {m2 > 0 && <span className="shrink-0 text-xs text-primary-600">≈{m2.toFixed(1)}m²</span>}
                </div>
                <select
                  value={l.unitName}
                  onChange={(e) => changeUnit(l.key, e.target.value)}
                  className="shrink-0 text-sm px-2 py-1.5 rounded-md border border-border bg-surface"
                >
                  <option value={l.product.baseUnit}>{l.product.baseUnit}</option>
                  {l.product.units.map((u) => (
                    <option key={u.unitName} value={u.unitName}>{u.unitName}</option>
                  ))}
                </select>
                <div className="flex items-center shrink-0">
                  <button onClick={() => updateQty(l.key, -1)} className="w-8 h-8 rounded-l-md border border-border border-r-0 grid place-items-center text-slate-500 hover:text-er hover:bg-surface-2">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    value={l.quantity}
                    onChange={(e) => setQty(l.key, Number(e.target.value))}
                    className="no-spinner w-12 py-1.5 text-center text-sm border-y border-border bg-surface"
                  />
                  <button onClick={() => updateQty(l.key, 1)} className="w-8 h-8 rounded-r-md border border-border border-l-0 grid place-items-center text-slate-500 hover:text-primary-600 hover:bg-surface-2">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => setEditKey(editKey === l.key ? null : l.key)}
                  title={t("pos.priceEditor.editHint")}
                  className="w-28 text-right text-base tabular-nums text-slate-500 hover:text-primary-600 shrink-0"
                >
                  {formatCurrency(eff.price)}
                </button>
                <span className="w-28 text-right text-base font-bold tabular-nums shrink-0">{formatCurrency(eff.price * l.quantity)}</span>
                <button onClick={() => setEditKey(editKey === l.key ? null : l.key)} className="w-7 h-7 rounded-md hover:bg-surface-2 grid place-items-center shrink-0 text-slate-400">
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
      <div className={cn("flex-1 flex flex-col p-3 sm:p-4 min-w-0", mobileView === "cart" && "hidden lg:flex")}>
        {/* nút sang trang thanh toán — chỉ mobile */}
        {cart.length > 0 && (
          <button onClick={() => setMobileView("cart")}
            className="lg:hidden fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 px-5 py-3 rounded-full bg-primary-600 text-white font-semibold shadow-e2">
            <ShoppingCart className="w-4 h-4" /> {t("pos.checkout")} ({cart.reduce((s, l) => s + l.quantity, 0)}) · {formatCurrency(total)}
          </button>
        )}
        <div className="mb-3 space-y-2">
          {invoiceTabs}
          {sourceInvoice && (
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
                    tx={isEditMode ? "pos.invoiceEdit.editingFrom" : "pos.invoiceEdit.copyingFrom"}
                    txOptions={{ code: sourceInvoice.code }}
                  />
                  <Text
                    as="div"
                    variant="muted"
                    size="xs"
                    className="mt-0.5"
                    tx={isEditMode ? "pos.invoiceEdit.editDescription" : "pos.invoiceEdit.copyDescription"}
                    txOptions={{ dateTime: sourceInvoice.saleTime ?? "—" }}
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={sourceInvoice.id ? Routes.order(sourceInvoice.id) : Routes.Orders}
                    target="_blank"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3 text-xs font-semibold text-slate-600")}
                  >
                    {t("pos.invoiceEdit.viewOriginal")}
                  </Link>
                </div>
              </div>
            </div>
          )}
          <div ref={searchRef} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setBrowsing(true)}
              placeholder={t("pos.searchPlaceholder")}
              className="w-full pl-10 pr-10 py-3 rounded-xl border border-border bg-surface"
            />
            {showResults && (
              <button
                type="button"
                onClick={closeSearch}
                title={t("common.close")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-9 h-9 lg:w-7 lg:h-7 rounded-md text-slate-400 hover:text-slate-600 hover:bg-surface-2"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* dropdown kết quả nổi dưới ô tìm — giỏ hàng vẫn hiện phía sau */}
            {showResults && (
              <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface border border-border rounded-xl shadow-e2 max-h-[min(64dvh,520px)] overflow-auto">
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
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => updateQty(line.key, -1)} className="w-8 h-8 rounded border border-border grid place-items-center"><Minus className="w-3.5 h-3.5" /></button>
                                <input
                                  type="number"
                                  value={line.quantity}
                                  onChange={(e) => setQty(line.key, Number(e.target.value))}
                                  className="no-spinner w-12 px-1 py-1 text-center text-sm rounded border border-border bg-surface"
                                />
                                <button onClick={() => updateQty(line.key, 1)} className="w-8 h-8 rounded border border-border grid place-items-center"><Plus className="w-3.5 h-3.5" /></button>
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
          </div>
        </div>

        {orderLinesPanel}
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
            <div className="flex-1 min-w-0">
              <Combobox
                value={customerId}
                onChange={changeCustomer}
                placeholder={t("pos.walkInCustomer")}
                options={data.customers.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }))}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPriceBookOpen(true)}
              title={t("pos.priceBook.title")}
              className={cn(
                "shrink-0 gap-1.5 whitespace-nowrap",
                !isDefaultBook && "border-primary-500 text-primary-700 dark:text-primary-300"
              )}
            >
              <Tag className="text-slate-400" />
              <span className="hidden sm:inline">{priceBookName}</span>
              <ChevronDown className="text-slate-400" />
            </Button>
          </div>
          {customer && Number(customer.currentDebt) > 0 && (
            <p className="text-xs text-warn">
              {t("pos.customerDebt", { debt: formatCurrency(Number(customer.currentDebt)) })}
            </p>
          )}
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
        </div>

        {/* totals + payment — đẩy lên ngay dưới khách hàng */}
        <div className="p-3 border-t border-border space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">{t("pos.subtotal")}</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
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
          <div className="flex justify-between text-base font-semibold pt-1">
            <span>{t("pos.total")}</span>
            <span className="text-primary-600 tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* phương thức + nút — ghim đáy panel */}
        <div className="p-3 border-t border-border space-y-2 text-sm">
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
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <div className="relative">
              <button
                disabled={cart.length === 0 || submitting}
                onClick={() => setPrintMenuOpen((o) => !o)}
                title={t("pos.printSlip")}
                className="h-full px-3 py-3 rounded-xl border border-border text-sm font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {t("pos.printSlip")}
              </button>
              {printMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPrintMenuOpen(false)} />
                  <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[150px] bg-surface border border-border rounded-lg shadow-e2 overflow-hidden py-1">
                    <button onClick={() => doPrint("a5")} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2">{t("pos.printA5")}</button>
                    <button onClick={() => doPrint("k80")} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2">{t("pos.printK80")}</button>
                  </div>
                </>
              )}
            </div>
            <button
              disabled={cart.length === 0 || submitting || !data.warehouse || !!sourceInvoice}
              onClick={() => submitOrder("quote")}
              className="px-3 py-3 rounded-xl border border-border text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              📑 {t("pos.saveQuote")}
            </button>
            <button
              disabled={cart.length === 0 || submitting || !data.warehouse}
              onClick={checkout}
              className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditMode ? t("pos.invoiceEdit.saveEdited") : isCopyMode ? t("pos.invoiceEdit.createCopy") : t("pos.checkout")} · {formatCurrency(total)}
            </button>
          </div>
          {isEditMode && (
            <Text as="p" variant="muted" className="text-[11px] text-right" tx="pos.invoiceEdit.editFootnote" />
          )}
        </div>
      </div>

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

      {priceBookOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setPriceBookOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-surface rounded-2xl shadow-e2 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary-600" /> {t("pos.priceBook.title")}
              </h3>
              <Button variant="ghost" size="iconSm" onClick={() => setPriceBookOpen(false)} aria-label={t("common.close")}>
                <X />
              </Button>
            </div>
            <div className="p-2">
              {data.priceBooks.map((pb) => {
                const selected = pb.id === priceBook || (isDefaultBook && pb.id === defaultBook?.id);
                return (
                  <Button
                    key={pb.id}
                    variant="ghost"
                    block
                    onClick={() => { changePriceBook(pb.isDefault ? "" : pb.id); setPriceBookOpen(false); }}
                    className={cn(
                      "h-auto justify-between py-2.5 font-normal",
                      selected && "bg-primary-50 dark:bg-primary-950/40 font-medium"
                    )}
                  >
                    <span>{pb.name}</span>
                    {selected && <Check className="text-primary-600" />}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Phiếu tạm để in (ẩn trên màn hình, chỉ hiện khi in) */}
      {printSize && createPortal(
        <div className="pos-print-root">
          <PrintDoc
            template={printTemplate}
            size={printSize}
            title={t("pos.tempSlipTitle")}
            code={printCode}
            date={printDate}
            partyLabel={t("orders.cols.customer")}
            partyName={customer?.name ?? t("pos.walkInCustomer")}
            partyPhone={customer?.phone}
            projectName={projectName || null}
            sellerLabel={t("orders.detail.seller")}
            items={cart.map((l) => {
              const e = effPrice(l);
              return { id: l.key, name: l.product.name, unitName: l.unitName, quantity: l.quantity, unitPrice: e.price, total: e.price * l.quantity };
            })}
            totals={[
              { label: t("pos.subtotal"), value: subtotal },
              ...(discountVnd > 0 ? [{ label: t("pos.discount"), value: discountVnd, negative: true }] : []),
              ...(taxAmount > 0 ? [{ label: t("pos.tax"), value: taxAmount }] : []),
              ...(shippingFee > 0 ? [{ label: t("pos.shipping"), value: shippingFee }] : []),
            ]}
            grandTotalLabel={t("print.grandTotal")}
            grandTotal={total}
            afterTotals={printTemplate.options.showDebt && payMethod !== "credit" && paid > 0
              ? [
                  { label: t("print.paid"), value: paid },
                  ...(remaining > 0 ? [{ label: t("print.remaining"), value: remaining, bold: true }] : []),
                ]
              : []}
            inWordsLabel={t("print.inWords")}
            signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
            signHint={t("print.signHint")}
            cols={{
              product: t("orders.cols.product"),
              unit: t("orders.cols.unit"),
              qty: t("orders.cols.qty"),
              unitPrice: t("orders.cols.unitPrice"),
              lineTotal: t("orders.cols.lineTotal"),
            }}
          />
        </div>,
        document.body
      )}
    </div>
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
