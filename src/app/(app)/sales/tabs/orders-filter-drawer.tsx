"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Barcode,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import {
  DEFAULT_ORDER_TIME_PRESET,
  ORDER_TIME_PRESETS,
  isOrderDateRangeValid,
  isOrderTimePreset,
  oneYearAfterDateValue,
  resolveOrderTimePreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import { cn } from "@/lib/utils";

export type OrdersFilterValues = {
  q: string;
  customerId: string;
  customerLabel: string;
  productId: string;
  productLabel: string;
  status: string;
  payment: string;
  paymentMethod: string;
  source: string;
  timePreset: string;
  from: string;
  to: string;
  minTotal: string;
  maxTotal: string;
  includeCancelled: boolean;
};

const orderStatuses = [
  "all",
  "draft",
  "confirmed",
  "delivering",
  "completed",
  "owing",
  "returned",
  "cancelled",
] as const;
const paymentStatuses = ["all", "paid", "partial", "unpaid"] as const;
const paymentMethods = ["all", "cash", "bank_transfer", "card"] as const;
const sources = [
  "all",
  "pos",
  "shopee",
  "tiktok_shop",
  "lazada",
  "tiki",
] as const;

export function OrdersFilterDrawer({ values }: { values: OrdersFilterValues }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const initialPreset: OrderTimePreset = isOrderTimePreset(values.timePreset)
    ? values.timePreset
    : values.from || values.to
      ? "custom"
      : DEFAULT_ORDER_TIME_PRESET;
  const initialRange =
    resolveOrderTimePreset(initialPreset) ??
    resolveOrderTimePreset(DEFAULT_ORDER_TIME_PRESET) ?? { from: "", to: "" };
  const [timePreset, setTimePreset] = useState(initialPreset);
  const [from, setFrom] = useState(values.from || initialRange.from);
  const [to, setTo] = useState(values.to || initialRange.to);
  const dateRangeError = timePreset !== "all" && !isOrderDateRangeValid(from, to);

  const hiddenFilters = (
    <>
      {values.customerId && (
        <input
          type="hidden"
          name="customerId"
          value={values.customerId}
        />
      )}
      {values.customerLabel && (
        <input type="hidden" name="customerLabel" value={values.customerLabel} />
      )}
      {values.productId && (
        <input type="hidden" name="productId" value={values.productId} />
      )}
      {values.productLabel && (
        <input type="hidden" name="productLabel" value={values.productLabel} />
      )}
      {values.status !== "all" && (
        <input type="hidden" name="status" value={values.status} />
      )}
      {values.payment !== "all" && (
        <input type="hidden" name="payment" value={values.payment} />
      )}
      {values.paymentMethod !== "all" && (
        <input
          type="hidden"
          name="paymentMethod"
          value={values.paymentMethod}
        />
      )}
      {values.source !== "all" && (
        <input type="hidden" name="source" value={values.source} />
      )}
      <input type="hidden" name="timePreset" value={values.timePreset} />
      {values.from && <input type="hidden" name="from" value={values.from} />}
      {values.to && <input type="hidden" name="to" value={values.to} />}
      {values.minTotal && (
        <input type="hidden" name="minTotal" value={values.minTotal} />
      )}
      {values.maxTotal && (
        <input type="hidden" name="maxTotal" value={values.maxTotal} />
      )}
      {values.includeCancelled && (
        <input type="hidden" name="includeCancelled" value="1" />
      )}
    </>
  );

  function selectTimePreset(preset: OrderTimePreset) {
    setTimePreset(preset);
    if (preset === "custom") {
      if (!from || !to) {
        const fallback = resolveOrderTimePreset(DEFAULT_ORDER_TIME_PRESET);
        setFrom(fallback?.from ?? "");
        setTo(fallback?.to ?? "");
      }
      return;
    }
    const range = resolveOrderTimePreset(preset);
    setFrom(range?.from ?? "");
    setTo(range?.to ?? "");
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <form action={Routes.Sales} className="relative w-full max-w-md">
          <input type="hidden" name="tab" value="orders" />
          {hiddenFilters}
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            name="q"
            defaultValue={values.q}
            placeholder={t("orders.searchPlaceholder")}
            aria-label={t("common.search")}
            className="min-h-11 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          />
        </form>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-primary-600 bg-surface px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <SlidersHorizontal className="size-4" />
          Lọc
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="orders-filter-title"
            className="ml-auto flex h-full w-full max-w-md flex-col bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start border-b border-border px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2
                  id="orders-filter-title"
                  className="text-lg font-extrabold text-slate-900 dark:text-slate-100"
                >
                  Bộ lọc đơn hàng
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Thu hẹp danh sách đơn bán
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              action={Routes.Sales}
              className="flex min-h-0 flex-1 flex-col"
            >
              <input type="hidden" name="tab" value="orders" />
              {values.q && <input type="hidden" name="q" value={values.q} />}
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <FilterSection title="Tìm theo">
                  <EntityPicker
                    label="Khách hàng"
                    name="customerId"
                    labelName="customerLabel"
                    initialValue={values.customerId}
                    initialLabel={values.customerLabel}
                    placeholder="Tên hoặc số điện thoại"
                    icon={<Search className="size-4" />}
                    endpoint="/api/mobile/customers"
                    kind="customer"
                  />
                  <EntityPicker
                    label="Sản phẩm"
                    name="productId"
                    labelName="productLabel"
                    initialValue={values.productId}
                    initialLabel={values.productLabel}
                    placeholder="Tên, SKU hoặc mã vạch"
                    icon={<Barcode className="size-4" />}
                    endpoint="/api/mobile/pos/search"
                    kind="product"
                  />
                </FilterSection>

                <FilterSection title="Thời gian">
                  <LumaWebPicker
                    label="Khoảng thời gian"
                    ariaLabel="Khoảng thời gian"
                    name="timePreset"
                    value={timePreset}
                    options={[...ORDER_TIME_PRESETS]}
                    onChange={(value) =>
                      selectTimePreset(value as OrderTimePreset)
                    }
                  />
                  {timePreset !== "all" && (
                    <>
                      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
                        <CalendarDays className="size-4 text-slate-500" />
                        <input
                          type="date"
                          name="from"
                          aria-label="Từ ngày"
                          value={from}
                          max={to || undefined}
                          onChange={(event) => {
                            setFrom(event.target.value);
                            setTimePreset("custom");
                          }}
                          className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-xs"
                        />
                        <input
                          type="date"
                          name="to"
                          aria-label="Đến ngày"
                          value={to}
                          min={from || undefined}
                          max={oneYearAfterDateValue(from)}
                          onChange={(event) => {
                            setTo(event.target.value);
                            setTimePreset("custom");
                          }}
                          className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-xs"
                        />
                      </div>
                      {dateRangeError && (
                        <p className="text-xs font-semibold text-red-600">
                          Khoảng ngày không hợp lệ hoặc vượt quá 1 năm.
                        </p>
                      )}
                    </>
                  )}
                </FilterSection>

                <PickerSection
                  title="Trạng thái đơn"
                  name="status"
                  value={values.status}
                  options={orderStatuses.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "draft"
                          ? "Nháp"
                          : value === "confirmed"
                            ? "Đặt hàng"
                            : value === "delivering"
                              ? "Đang giao"
                              : value === "completed"
                                ? "Hoàn tất"
                                : value === "owing"
                                  ? "Còn nợ"
                                  : value === "returned"
                                    ? "Đã trả hàng"
                                    : "Đã hủy",
                  }))}
                />
                <PickerSection
                  title="Trạng thái thanh toán"
                  name="payment"
                  value={values.payment}
                  options={paymentStatuses.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "paid"
                          ? "Đã thanh toán"
                          : value === "partial"
                            ? "Thanh toán một phần"
                            : "Chưa thanh toán",
                  }))}
                />
                <ChipSection
                  title="Phương thức thanh toán"
                  name="paymentMethod"
                  value={values.paymentMethod}
                  options={paymentMethods.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "cash"
                          ? "Tiền mặt"
                          : value === "bank_transfer"
                            ? "Chuyển khoản"
                            : "Thẻ",
                  }))}
                />
                <ChipSection
                  title="Nguồn đơn"
                  name="source"
                  value={values.source}
                  options={sources.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "tiktok_shop"
                          ? "TikTok Shop"
                          : value.charAt(0).toUpperCase() + value.slice(1),
                  }))}
                />

                <label className="flex items-center gap-4 border-y border-border py-4">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">
                      Hiện đơn đã hủy
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Mặc định được ẩn khỏi danh sách
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    name="includeCancelled"
                    value="1"
                    defaultChecked={values.includeCancelled}
                    className="peer sr-only"
                  />
                  <span className="relative h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-primary-600 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
                </label>

                <FilterSection title="Giá trị đơn">
                  <div className="grid grid-cols-2 gap-3">
                    <LabeledInput
                      label="Từ"
                      name="minTotal"
                      defaultValue={values.minTotal}
                      placeholder="0"
                      suffix="đ"
                    />
                    <LabeledInput
                      label="Đến"
                      name="maxTotal"
                      defaultValue={values.maxTotal}
                      placeholder="Không giới hạn"
                      suffix="đ"
                    />
                  </div>
                </FilterSection>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-6 py-4">
                <a
                  href={`${Routes.Sales}?tab=orders`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700"
                >
                  Xóa lọc
                </a>
                <button
                  type="submit"
                  disabled={dateRangeError}
                  className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Xem đơn hàng
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function LabeledInput({
  label,
  icon,
  suffix,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: ReactNode;
  suffix?: string;
}) {
  return (
    <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-100">
      <span className="block text-xs text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        {icon && <span className="text-slate-500">{icon}</span>}
        <input
          {...props}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
        />
        {suffix && <span className="text-sm font-semibold">{suffix}</span>}
      </span>
    </label>
  );
}

type EntityOption = {
  value: string;
  label: string;
  hint?: string;
};

function EntityPicker({
  label,
  name,
  labelName,
  initialValue,
  initialLabel,
  placeholder,
  icon,
  endpoint,
  kind,
}: {
  label: string;
  name: "customerId" | "productId";
  labelName: "customerLabel" | "productLabel";
  initialValue: string;
  initialLabel: string;
  placeholder: string;
  icon: ReactNode;
  endpoint: string;
  kind: "customer" | "product";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(initialValue);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel);
  const [selectedHint, setSelectedHint] = useState("");
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const url = new URL(endpoint, window.location.origin);
        if (query.trim()) url.searchParams.set("q", query.trim());
        if (kind === "customer") url.searchParams.set("pageSize", "30");
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("request_failed");
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: unknown;
        };
        if (!payload.ok) throw new Error("request_failed");
        setOptions(parseEntityOptions(payload.data, kind));
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setOptions([]);
          setError("Không thể tải danh sách. Vui lòng thử lại.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [endpoint, kind, open, query]);

  function pick(option: EntityOption) {
    setValue(option.value);
    setSelectedLabel(option.label);
    setSelectedHint(option.hint ?? "");
    setOpen(false);
    setQuery("");
  }

  function clear() {
    setValue("");
    setSelectedLabel("");
    setSelectedHint("");
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={labelName} value={selectedLabel} />
      <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${name}-options`}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"
      >
        <span className="shrink-0 text-slate-500">{icon}</span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              selectedLabel
                ? "font-semibold text-slate-900 dark:text-slate-100"
                : "text-slate-400",
            )}
          >
            {selectedLabel || placeholder}
          </span>
          {selectedHint && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {selectedHint}
            </span>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="relative border-b border-border p-3">
            <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={`Tìm ${label.toLocaleLowerCase("vi")}`}
              className="min-h-10 w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div id={`${name}-options`} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {value && (
              <button
                type="button"
                onClick={clear}
                className="flex min-h-11 w-full items-center px-4 text-left text-sm font-semibold text-slate-500 hover:bg-surface-2"
              >
                Bỏ lựa chọn
              </button>
            )}
            {loading ? (
              <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Đang tải...
              </div>
            ) : error ? (
              <p className="px-4 py-5 text-center text-sm text-red-600">{error}</p>
            ) : options.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-slate-500">
                Không tìm thấy kết quả
              </p>
            ) : (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2",
                    option.value === value && "bg-primary-50 dark:bg-primary-950/30",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Check className="size-4 shrink-0 text-primary-600" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseEntityOptions(
  data: unknown,
  kind: "customer" | "product",
): EntityOption[] {
  const rows = kind === "customer"
    ? (data as { rows?: unknown[] } | undefined)?.rows
    : data;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!id || !name) return [];
    const code = typeof row.code === "string" ? row.code : "";
    const phone = typeof row.phone === "string" ? row.phone : "";
    const sku = typeof row.sku === "string" ? row.sku : "";
    const barcode = typeof row.barcode === "string" ? row.barcode : "";
    const hint = kind === "customer"
      ? [code, phone].filter(Boolean).join(" · ")
      : [sku, barcode].filter(Boolean).join(" · ");
    return [{ value: id, label: name, hint }];
  });
}

function ChipSection({
  title,
  name,
  value,
  options,
}: {
  title: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <FilterSection title={title}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={value === option.value}
              className="peer sr-only"
            />
            <span className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold transition peer-checked:border-primary-600 peer-checked:bg-primary-50 peer-checked:text-primary-700">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </FilterSection>
  );
}

function PickerSection({
  title,
  name,
  value,
  options,
}: {
  title: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <FilterSection title={title}>
      <LumaWebPicker
        name={name}
        ariaLabel={title}
        defaultValue={value}
        options={options}
      />
    </FilterSection>
  );
}

function LumaWebPicker({
  label,
  ariaLabel,
  name,
  value,
  defaultValue = "",
  options,
  onChange,
}: {
  label?: string;
  ariaLabel: string;
  name: string;
  value?: string;
  defaultValue?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (value: string) => void;
}) {
  const listboxId = `luma-picker-${useId().replaceAll(":", "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selectedValue),
  );
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function focusOption(index: number) {
    const boundedIndex = (index + options.length) % options.length;
    window.requestAnimationFrame(() => optionRefs.current[boundedIndex]?.focus());
  }

  function openAndFocus(index: number) {
    setOpen(true);
    focusOption(index);
  }

  function select(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAndFocus(selectedIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAndFocus(selectedIndex || options.length - 1);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handleOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={selectedValue} />
      {label && (
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm font-semibold outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption?.label ?? "Chọn"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180 text-primary-600",
          )}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          {options.map((option, index) => {
            const selected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold outline-none transition hover:bg-surface-2 focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-primary-200 dark:focus-visible:bg-primary-950/30",
                  selected &&
                    "bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300",
                )}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {selected && <Check className="size-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
