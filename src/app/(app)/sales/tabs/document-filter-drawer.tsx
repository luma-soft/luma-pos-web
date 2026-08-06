"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Barcode,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Search,
  SlidersHorizontal,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import { Routes } from "@/lib/routes";
import {
  BOOKING_DELIVERY_PRESETS,
  DEFAULT_ORDER_TIME_PRESET,
  ORDER_TIME_PRESETS,
  isBookingDeliveryPreset,
  isOrderDateRangeValid,
  isOrderTimePreset,
  resolveBookingDeliveryPreset,
  resolveOrderTimePreset,
  type BookingDeliveryPreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import {
  returnReasonLabels,
  returnReasons,
  returnRefundMethods,
} from "@/lib/returns/list-filter-schema";
import { cn } from "@/lib/utils";

export type DocumentFilterKind = "returns" | "quotes" | "bookings";

export type DocumentFilterValues = {
  q: string;
  customerId: string;
  customerLabel: string;
  productId: string;
  productLabel: string;
  projectId?: string;
  projectLabel?: string;
  projectQuery?: string;
  orderId?: string;
  orderLabel?: string;
  warehouseId?: string;
  warehouseLabel?: string;
  timePreset: string;
  from: string;
  to: string;
  deliveryPreset?: string;
  deliveryFrom?: string;
  deliveryTo?: string;
  status?: string;
  payment?: string;
  reason?: string;
  refundMethod?: string;
  minTotal: string;
  maxTotal: string;
  includeCancelled?: boolean;
};

const copy = {
  returns: {
    title: "Bộ lọc trả hàng",
    subtitle: "Thu hẹp danh sách phiếu trả hàng",
    search: "Tìm mã phiếu, khách hàng, đơn gốc...",
    unit: "phiếu",
  },
  quotes: {
    title: "Bộ lọc báo giá",
    subtitle: "Thu hẹp danh sách báo giá",
    search: "Tìm mã báo giá, khách hàng, công trình...",
    unit: "báo giá",
  },
  bookings: {
    title: "Bộ lọc đặt hàng",
    subtitle: "Thu hẹp danh sách đặt hàng",
    search: "Tìm mã đặt hàng, khách hàng, công trình...",
    unit: "đơn",
  },
} as const;

const quoteStatuses = [
  { value: "quote", label: "Đang mở" },
  { value: "all", label: "Tất cả" },
  { value: "cancelled", label: "Đã hủy" },
] as const;
const bookingStatuses = [
  { value: "confirmed", label: "Đang chờ" },
  { value: "all", label: "Tất cả" },
  { value: "cancelled", label: "Đã hủy" },
] as const;
const paymentStatuses = [
  { value: "all", label: "Tất cả" },
  { value: "paid", label: "Đã thanh toán" },
  { value: "partial", label: "Thanh toán một phần" },
  { value: "unpaid", label: "Chưa thanh toán" },
] as const;
const refundMethodLabels: Record<string, string> = {
  all: "Tất cả",
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  debt_deduct: "Trừ công nợ",
  momo: "MoMo",
  zalopay: "ZaloPay",
  vnpay: "VNPay",
};

export function DocumentFilterDrawer({
  kind,
  values,
}: {
  kind: DocumentFilterKind;
  values: DocumentFilterValues;
}) {
  const labels = copy[kind];
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [revision, setRevision] = useState(0);
  const [amountError, setAmountError] = useState(() => {
    const min = Number(values.minTotal);
    const max = Number(values.maxTotal);
    return Boolean(values.minTotal && values.maxTotal && min > max);
  });
  const [count, setCount] = useState<number | null>(null);
  const [countPending, setCountPending] = useState(false);
  const initialPreset = isOrderTimePreset(values.timePreset)
    ? values.timePreset
    : DEFAULT_ORDER_TIME_PRESET;
  const initialRange = resolveOrderTimePreset(initialPreset) ??
    resolveOrderTimePreset(DEFAULT_ORDER_TIME_PRESET)!;
  const [timePreset, setTimePreset] = useState<OrderTimePreset>(initialPreset);
  const [from, setFrom] = useState(values.from || initialRange.from);
  const [to, setTo] = useState(values.to || initialRange.to);
  const initialDeliveryPreset = isBookingDeliveryPreset(values.deliveryPreset)
    ? values.deliveryPreset
    : "all";
  const initialDeliveryRange = resolveBookingDeliveryPreset(initialDeliveryPreset) ?? {
    from: values.deliveryFrom ?? "",
    to: values.deliveryTo ?? "",
  };
  const [deliveryPreset, setDeliveryPreset] = useState<BookingDeliveryPreset>(
    initialDeliveryPreset,
  );
  const [deliveryFrom, setDeliveryFrom] = useState(
    values.deliveryFrom || initialDeliveryRange.from,
  );
  const [deliveryTo, setDeliveryTo] = useState(
    values.deliveryTo || initialDeliveryRange.to,
  );

  const dateRangeError = timePreset !== "all" && !isOrderDateRangeValid(from, to);
  const deliveryRangeError = kind === "bookings" &&
    deliveryPreset !== "all" && deliveryPreset !== "overdue" &&
    !isOrderDateRangeValid(deliveryFrom, deliveryTo);
  const invalid = dateRangeError || deliveryRangeError || amountError;
  const badgeCount = countAppliedDocumentFilters(kind, values);

  useEffect(() => {
    if (!open || invalid || !formRef.current) return;
    const controller = new AbortController();
    const form = formRef.current;
    setCountPending(true);
    const timeout = window.setTimeout(async () => {
      const query = new URLSearchParams();
      for (const [name, value] of new FormData(form)) {
        if (typeof value === "string" && value.trim()) query.set(name, value);
      }
      for (const name of [
        "tab",
        "customerLabel",
        "productLabel",
        "projectLabel",
        "orderLabel",
        "warehouseLabel",
        "timePreset",
        "deliveryPreset",
      ]) query.delete(name);
      if (kind === "quotes") query.set("documentType", "quote");
      if (kind === "bookings") query.set("documentType", "booking");
      const endpoint = kind === "returns" ? "/api/returns/count" : "/api/orders/count";
      try {
        const response = await fetch(`${endpoint}?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { total?: unknown };
        };
        if (!response.ok || !payload.ok || typeof payload.data?.total !== "number") {
          throw new Error("request_failed");
        }
        setCount(payload.data.total);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setCount(null);
      } finally {
        if (!controller.signal.aborted) setCountPending(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [deliveryFrom, deliveryPreset, deliveryRangeError, deliveryTo, invalid, kind, open, revision, from, timePreset, to]);

  function refresh() {
    setAmountError(amountRangeInvalid(formRef.current));
    setRevision((current) => current + 1);
  }

  function selectTimePreset(value: string) {
    const preset = value as OrderTimePreset;
    setTimePreset(preset);
    const range = resolveOrderTimePreset(preset);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    }
    refresh();
  }

  function selectDeliveryPreset(value: string) {
    const preset = value as BookingDeliveryPreset;
    setDeliveryPreset(preset);
    const range = resolveBookingDeliveryPreset(preset);
    if (range) {
      setDeliveryFrom(range.from);
      setDeliveryTo(range.to);
    }
    refresh();
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <form action={Routes.Sales} className="relative w-full max-w-md">
          <input type="hidden" name="tab" value={kind} />
          <HiddenFilterInputs values={values} kind={kind} />
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            name="q"
            defaultValue={values.q}
            placeholder={labels.search}
            aria-label="Tìm kiếm"
            className="min-h-11 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          />
        </form>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Mở ${labels.title.toLocaleLowerCase("vi")}`}
          className="relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-primary-600 bg-surface px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Lọc</span>
          {badgeCount > 0 && (
            <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-primary-600 px-1 text-[11px] text-white" aria-label={`${badgeCount} điều kiện lọc`}>
              {badgeCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-950/35" role="presentation" onMouseDown={() => setOpen(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${kind}-filter-title`}
            className="ml-auto flex h-dvh w-full max-w-md flex-col bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start border-b border-border px-5 py-5 sm:px-6">
              <div className="min-w-0 flex-1">
                <h2 id={`${kind}-filter-title`} className="text-lg font-extrabold">{labels.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{labels.subtitle}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary-500">
                <X className="size-5" />
              </button>
            </header>

            <form ref={formRef} action={Routes.Sales} className="flex min-h-0 flex-1 flex-col" onChangeCapture={refresh}>
              <input type="hidden" name="tab" value={kind} />
              {values.q && <input type="hidden" name="q" value={values.q} />}
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                <FilterSection title="Tìm theo">
                  <EntityPicker name="customerId" labelName="customerLabel" kind="customer" label="Khách hàng" placeholder="Tên hoặc số điện thoại" initialValue={values.customerId} initialLabel={values.customerLabel} icon={<UserRound className="size-4" />} onSelectionChange={refresh} />
                  <EntityPicker name="productId" labelName="productLabel" kind="product" label="Sản phẩm" placeholder="Tên, SKU hoặc mã vạch" initialValue={values.productId} initialLabel={values.productLabel} icon={<Barcode className="size-4" />} onSelectionChange={refresh} />
                  {kind !== "returns" && (
                    <EntityPicker name="projectId" labelName="projectLabel" queryName="projectQuery" kind="project" label="Công trình" placeholder="Chọn công trình" initialValue={values.projectId ?? ""} initialLabel={values.projectLabel ?? values.projectQuery ?? ""} icon={<Building2 className="size-4" />} onSelectionChange={refresh} />
                  )}
                  {kind === "returns" && (
                    <>
                      <EntityPicker name="orderId" labelName="orderLabel" kind="order" label="Đơn gốc" placeholder="Chọn đơn bán gốc" initialValue={values.orderId ?? ""} initialLabel={values.orderLabel ?? ""} icon={<FileText className="size-4" />} onSelectionChange={refresh} />
                      <EntityPicker name="warehouseId" labelName="warehouseLabel" kind="warehouse" label="Kho nhận" placeholder="Chọn kho nhận" initialValue={values.warehouseId ?? ""} initialLabel={values.warehouseLabel ?? ""} icon={<Warehouse className="size-4" />} onSelectionChange={refresh} />
                    </>
                  )}
                </FilterSection>

                <FilterSection title={kind === "returns" ? "Thời gian" : "Thời gian tạo"}>
                  <LumaWebPicker name="timePreset" ariaLabel="Khoảng thời gian" value={timePreset} options={ORDER_TIME_PRESETS} onChange={selectTimePreset} />
                  {timePreset !== "all" && (
                    <LumaDateRangePicker fromName="from" toName="to" from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); setTimePreset("custom"); refresh(); }} error={dateRangeError ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm" : ""} />
                  )}
                </FilterSection>

                {kind === "returns" && (
                  <>
                    <FilterSection title="Lý do trả hàng">
                      <LumaWebPicker name="reason" ariaLabel="Lý do trả hàng" defaultValue={values.reason ?? "all"} options={returnReasons.map((value) => ({ value, label: returnReasonLabels[value] }))} onChange={refresh} />
                    </FilterSection>
                    <ChipSection title="Phương thức hoàn tiền" name="refundMethod" value={values.refundMethod ?? "all"} options={returnRefundMethods.map((value) => ({ value, label: refundMethodLabels[value] }))} />
                    <LumaSwitch name="includeCancelled" label="Hiện phiếu đã hủy" description="Mặc định được ẩn khỏi danh sách" defaultChecked={values.includeCancelled ?? false} />
                  </>
                )}

                {kind === "quotes" && (
                  <FilterSection title="Trạng thái">
                    <LumaWebPicker name="status" ariaLabel="Trạng thái báo giá" defaultValue={values.status ?? "quote"} options={quoteStatuses} onChange={refresh} />
                  </FilterSection>
                )}

                {kind === "bookings" && (
                  <>
                    <FilterSection title="Ngày giao">
                      <LumaWebPicker name="deliveryPreset" ariaLabel="Khoảng ngày giao" value={deliveryPreset} options={BOOKING_DELIVERY_PRESETS} onChange={selectDeliveryPreset} />
                      {deliveryPreset === "custom" && (
                        <LumaDateRangePicker fromName="deliveryFrom" toName="deliveryTo" from={deliveryFrom} to={deliveryTo} onChange={(nextFrom, nextTo) => { setDeliveryFrom(nextFrom); setDeliveryTo(nextTo); setDeliveryPreset("custom"); refresh(); }} error={deliveryRangeError ? "Khoảng ngày giao không hợp lệ hoặc vượt quá 1 năm" : ""} />
                      )}
                      {deliveryPreset === "overdue" && (
                        <input type="hidden" name="deliveryTo" value={deliveryTo} />
                      )}
                    </FilterSection>
                    <FilterSection title="Trạng thái">
                      <LumaWebPicker name="status" ariaLabel="Trạng thái đặt hàng" defaultValue={values.status ?? "confirmed"} options={bookingStatuses} onChange={refresh} />
                    </FilterSection>
                    <FilterSection title="Trạng thái thanh toán">
                      <LumaWebPicker name="payment" ariaLabel="Trạng thái thanh toán" defaultValue={values.payment ?? "all"} options={paymentStatuses} onChange={refresh} />
                    </FilterSection>
                  </>
                )}

                <FilterSection title={kind === "returns" ? "Khoảng tiền hoàn" : "Khoảng giá trị"}>
                  <div className="grid grid-cols-2 gap-3">
                    <MoneyInput label="Từ" name="minTotal" defaultValue={values.minTotal} placeholder="0" />
                    <MoneyInput label="Đến" name="maxTotal" defaultValue={values.maxTotal} placeholder="Không giới hạn" />
                  </div>
                  {amountError && <p className="text-xs font-semibold text-red-600">Giá trị từ không được lớn hơn giá trị đến.</p>}
                </FilterSection>
              </div>

              <footer className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6">
                <a href={`${Routes.Sales}?tab=${kind}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700">Xóa lọc</a>
                <button type="submit" disabled={invalid} aria-busy={countPending} className="min-h-11 rounded-xl bg-primary-600 px-3 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50">
                  <span aria-live="polite">{count === null ? `Xem … ${labels.unit}` : `Xem ${count} ${labels.unit}`}</span>
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

export function countAppliedDocumentFilters(kind: DocumentFilterKind, values: DocumentFilterValues) {
  const candidates = [
    values.customerId,
    values.productId,
    kind === "returns" ? values.orderId : values.projectId || values.projectQuery,
    kind === "returns" ? values.warehouseId : "",
    values.timePreset !== DEFAULT_ORDER_TIME_PRESET ? values.timePreset : "",
    kind === "returns" && values.reason !== "all" ? values.reason : "",
    kind === "returns" && values.refundMethod !== "all" ? values.refundMethod : "",
    kind === "quotes" && values.status !== "quote" ? values.status : "",
    kind === "bookings" && values.status !== "confirmed" ? values.status : "",
    kind === "bookings" && values.payment !== "all" ? values.payment : "",
    kind === "bookings" && values.deliveryPreset !== "all" ? values.deliveryPreset : "",
    values.minTotal,
    values.maxTotal,
    values.includeCancelled ? "1" : "",
  ];
  return candidates.filter(Boolean).length;
}

function HiddenFilterInputs({ values, kind }: { values: DocumentFilterValues; kind: DocumentFilterKind }) {
  const hidden: Array<[string, string | boolean | undefined]> = [
    ["customerId", values.customerId], ["customerLabel", values.customerLabel],
    ["productId", values.productId], ["productLabel", values.productLabel],
    ["projectId", values.projectId], ["projectLabel", values.projectLabel], ["projectQuery", values.projectQuery],
    ["orderId", values.orderId], ["orderLabel", values.orderLabel],
    ["warehouseId", values.warehouseId], ["warehouseLabel", values.warehouseLabel],
    ["timePreset", values.timePreset], ["from", values.from], ["to", values.to],
    ["deliveryPreset", values.deliveryPreset], ["deliveryFrom", values.deliveryFrom], ["deliveryTo", values.deliveryTo],
    ["status", values.status], ["payment", values.payment], ["reason", values.reason], ["refundMethod", values.refundMethod],
    ["minTotal", values.minTotal], ["maxTotal", values.maxTotal], ["includeCancelled", values.includeCancelled ? "1" : ""],
  ];
  return <>{hidden.map(([name, value]) => value ? <input key={`${kind}-${name}`} type="hidden" name={name} value={String(value)} /> : null)}</>;
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3"><h3 className="text-sm font-extrabold">{title}</h3>{children}</section>;
}

function MoneyInput({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue: string; placeholder: string }) {
  return <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100"><span className="block text-xs text-slate-500">{label}</span><span className="flex items-center gap-2"><input inputMode="decimal" name={name} defaultValue={defaultValue} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400" /><span className="text-sm font-semibold">đ</span></span></label>;
}

function amountRangeInvalid(form: HTMLFormElement | null) {
  if (!form) return false;
  const data = new FormData(form);
  const min = String(data.get("minTotal") ?? "").trim();
  const max = String(data.get("maxTotal") ?? "").trim();
  if (!min || !max) return false;
  const minValue = Number(min);
  const maxValue = Number(max);
  return Number.isFinite(minValue) && Number.isFinite(maxValue) && minValue > maxValue;
}

type EntityKind = "customer" | "product" | "project" | "order" | "warehouse";
type EntityOption = { id: string; label: string; hint?: string | null };

function EntityPicker({ name, labelName, queryName, kind, label, placeholder, initialValue, initialLabel, icon, onSelectionChange }: { name: string; labelName: string; queryName?: string; kind: EntityKind; label: string; placeholder: string; initialValue: string; initialLabel: string; icon: ReactNode; onSelectionChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(initialValue);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel);
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = `${name}-${useId().replaceAll(":", "")}`;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const url = new URL("/api/sales/filter-options", window.location.origin);
        url.searchParams.set("kind", kind);
        if (query.trim()) url.searchParams.set("q", query.trim());
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { ok?: boolean; data?: { rows?: EntityOption[] } };
        if (!response.ok || !payload.ok) throw new Error("request_failed");
        setOptions(payload.data?.rows ?? []); setActiveIndex(0);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") { setOptions([]); setError("Không thể tải danh sách. Vui lòng thử lại."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [kind, open, query]);

  function pick(option: EntityOption) { setValue(option.id); setSelectedLabel(option.label); setOpen(false); setQuery(""); onSelectionChange(); }
  function clear() { setValue(""); setSelectedLabel(""); setOpen(false); setQuery(""); onSelectionChange(); }
  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter" && options[activeIndex]) { event.preventDefault(); pick(options[activeIndex]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  }

  return <div ref={rootRef} className="relative">
    <input type="hidden" name={name} value={value} />
    <input type="hidden" name={labelName} value={selectedLabel} />
    {queryName && <input type="hidden" name={queryName} value={selectedLabel} />}
    <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
    <button type="button" role="combobox" aria-expanded={open} aria-controls={listboxId} onClick={() => { setOpen((current) => !current); window.requestAnimationFrame(() => searchRef.current?.focus()); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"><span className="shrink-0 text-slate-500">{icon}</span><span className={cn("min-w-0 flex-1 truncate text-sm", selectedLabel ? "font-semibold" : "text-slate-400")}>{selectedLabel || placeholder}</span><ChevronRight className="size-4 shrink-0 text-slate-400" /></button>
    {open && <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"><div className="relative border-b border-border p-3"><Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder={placeholder} aria-label={`Tìm ${label.toLocaleLowerCase("vi")}`} className="min-h-10 w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" /></div><div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">{value && <button type="button" onClick={clear} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-slate-500 hover:bg-surface-2">Bỏ lựa chọn</button>}{loading ? <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Đang tải...</div> : error ? <p className="px-4 py-5 text-center text-sm text-red-600">{error}</p> : options.length === 0 ? <p className="px-4 py-5 text-center text-sm text-slate-500">Không tìm thấy kết quả</p> : options.map((option, index) => <button key={option.id} type="button" role="option" aria-selected={option.id === value} data-active={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => pick(option)} className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary-200", index === activeIndex && "bg-surface-2", option.id === value && "bg-primary-50 text-primary-700")}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{option.label}</span>{option.hint && <span className="mt-0.5 block truncate text-xs text-slate-500">{option.hint}</span>}</span>{option.id === value && <Check className="size-4" />}</button>)}</div></div>}
  </div>;
}

function LumaWebPicker({ name, ariaLabel, value, defaultValue = "", options, onChange }: { name: string; ariaLabel: string; value?: string; defaultValue?: string; options: ReadonlyArray<{ value: string; label: string }>; onChange?: (value: string) => void }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selectedValue = value ?? internalValue;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selectedValue));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `picker-${useId().replaceAll(":", "")}`;
  useEffect(() => { if (!open) return; const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  function focus(index: number) { const target = (index + options.length) % options.length; window.requestAnimationFrame(() => refs.current[target]?.focus()); }
  function select(next: string) { if (value === undefined) setInternalValue(next); onChange?.(next); setOpen(false); window.requestAnimationFrame(() => triggerRef.current?.focus()); }
  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); focus(event.key === "ArrowDown" ? selectedIndex : selectedIndex || options.length - 1); } else if (event.key === "Escape") setOpen(false); }
  function onOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) { if (event.key === "ArrowDown") { event.preventDefault(); focus(index + 1); } else if (event.key === "ArrowUp") { event.preventDefault(); focus(index - 1); } else if (event.key === "Home") { event.preventDefault(); focus(0); } else if (event.key === "End") { event.preventDefault(); focus(options.length - 1); } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } }
  return <div ref={rootRef} className="relative"><input type="hidden" name={name} value={selectedValue} /><button ref={triggerRef} type="button" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listboxId} onClick={() => setOpen((current) => !current)} onKeyDown={onTriggerKeyDown} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm font-semibold outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"><span className="truncate">{options[selectedIndex]?.label ?? "Chọn"}</span><ChevronDown className={cn("size-4 text-slate-400 transition-transform", open && "rotate-180 text-primary-600")} /></button>{open && <div id={listboxId} role="listbox" aria-label={ariaLabel} className="absolute inset-x-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-2xl">{options.map((option, index) => <button key={option.value} ref={(element) => { refs.current[index] = element; }} type="button" role="option" aria-selected={option.value === selectedValue} onClick={() => select(option.value)} onKeyDown={(event) => onOptionKeyDown(event, index)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold outline-none transition hover:bg-surface-2 focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-primary-200", option.value === selectedValue && "bg-primary-50 text-primary-700")}><span className="min-w-0 flex-1">{option.label}</span>{option.value === selectedValue && <Check className="size-4" />}</button>)}</div>}</div>;
}

function LumaDateRangePicker({ fromName, toName, from, to, onChange, error }: { fromName: string; toName: string; from: string; to: string; onChange: (from: string, to: string) => void; error: string }) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  const draftValid = isOrderDateRangeValid(draftFrom, draftTo);
  function toggle() {
    if (!open) {
      setDraftFrom(from);
      setDraftTo(to);
    }
    setOpen((current) => !current);
  }
  return <div ref={rootRef} className="relative"><input type="hidden" name={fromName} value={from} /><input type="hidden" name={toName} value={to} /><button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={toggle} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"><CalendarDays className="size-4 text-slate-500" /><span className="min-w-0 flex-1 font-semibold">{from || "Từ ngày"} – {to || "Đến ngày"}</span><ChevronDown className={cn("size-4 text-slate-400 transition-transform", open && "rotate-180")} /></button>{error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}{open && <div role="dialog" aria-label="Chọn khoảng ngày" className="absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-border bg-surface p-4 shadow-2xl"><p className="text-sm font-extrabold">Nhập khoảng ngày</p><p className="mt-1 text-xs text-slate-500">Định dạng YYYY-MM-DD · tối đa 1 năm</p><div className="mt-3 grid grid-cols-2 gap-3"><label className="rounded-lg border border-border px-3 py-2 focus-within:border-primary-500"><span className="block text-xs text-slate-500">Từ ngày</span><input autoFocus type="text" inputMode="numeric" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} className="mt-1 w-full bg-transparent text-sm outline-none" /></label><label className="rounded-lg border border-border px-3 py-2 focus-within:border-primary-500"><span className="block text-xs text-slate-500">Đến ngày</span><input type="text" inputMode="numeric" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} className="mt-1 w-full bg-transparent text-sm outline-none" /></label></div>{!draftValid && <p className="mt-2 text-xs font-semibold text-red-600">Khoảng ngày không hợp lệ hoặc vượt quá 1 năm.</p>}<div className="mt-4 grid grid-cols-2 gap-3"><button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-border font-semibold">Hủy</button><button type="button" disabled={!draftValid} onClick={() => { onChange(draftFrom, draftTo); setOpen(false); }} className="min-h-10 rounded-lg bg-primary-600 font-semibold text-white disabled:opacity-50">Áp dụng</button></div></div>}</div>;
}

function ChipSection({ title, name, value, options }: { title: string; name: string; value: string; options: Array<{ value: string; label: string }> }) {
  return <FilterSection title={title}><div className="flex flex-wrap gap-2">{options.map((option) => <label key={option.value} className="cursor-pointer"><input type="radio" name={name} value={option.value} defaultChecked={value === option.value} className="peer sr-only" /><span className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold transition hover:border-primary-300 peer-checked:border-primary-600 peer-checked:bg-primary-50 peer-checked:text-primary-700 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500">{option.label}</span></label>)}</div></FilterSection>;
}

function LumaSwitch({ name, label, description, defaultChecked }: { name: string; label: string; description: string; defaultChecked: boolean }) {
  return <label className="flex items-center gap-4 border-y border-border py-4"><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></span><input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className="peer sr-only" /><span className="relative h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-primary-600 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" /></label>;
}
