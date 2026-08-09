"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Barcode, Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import {
  DEFAULT_TIME_FILTER_PRESET,
  ORDER_TIME_PRESETS,
  isOrderDateRangeValid,
  isOrderTimePreset,
  resolveOrderTimePreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import {
  LumaDateRangePicker,
  LumaEntityPicker,
  LumaWebPicker,
  collectFocusableElements,
} from "./filter-drawer-shared";

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

type OrdersFilterDraft = Omit<OrdersFilterValues, "q">;

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

function createDraftFromValues(values: OrdersFilterValues): OrdersFilterDraft {
  const timePreset =
    isOrderTimePreset(values.timePreset) && values.timePreset !== "custom"
      ? values.timePreset
      : values.from || values.to
        ? "custom"
        : DEFAULT_TIME_FILTER_PRESET;
  const range = resolveOrderTimePreset(timePreset) ??
    resolveOrderTimePreset(DEFAULT_TIME_FILTER_PRESET)!;
  return {
    customerId: values.customerId,
    customerLabel: values.customerLabel,
    productId: values.productId,
    productLabel: values.productLabel,
    status: values.status,
    payment: values.payment,
    paymentMethod: values.paymentMethod,
    source: values.source,
    timePreset,
    from: values.from || range.from,
    to: values.to || range.to,
    minTotal: values.minTotal,
    maxTotal: values.maxTotal,
    includeCancelled: values.includeCancelled,
  };
}

function createFilterCountQuery(
  draft: OrdersFilterDraft,
  searchText: string,
) {
  const query = new URLSearchParams();
  query.set("tab", "orders");
  if (searchText.trim()) query.set("q", searchText.trim());
  if (draft.customerId) query.set("customerId", draft.customerId);
  if (draft.customerLabel) query.set("customerLabel", draft.customerLabel);
  if (draft.productId) query.set("productId", draft.productId);
  if (draft.productLabel) query.set("productLabel", draft.productLabel);
  if (draft.status !== "all") query.set("status", draft.status);
  if (draft.payment !== "all") query.set("payment", draft.payment);
  if (draft.paymentMethod !== "all") query.set("paymentMethod", draft.paymentMethod);
  if (draft.source !== "all") query.set("source", draft.source);
  if (draft.timePreset !== DEFAULT_TIME_FILTER_PRESET || draft.from || draft.to) {
    query.set("timePreset", draft.timePreset);
  }
  if (draft.from) query.set("from", draft.from);
  if (draft.to) query.set("to", draft.to);
  if (draft.minTotal.trim()) query.set("minTotal", draft.minTotal.trim());
  if (draft.maxTotal.trim()) query.set("maxTotal", draft.maxTotal.trim());
  if (draft.includeCancelled) query.set("includeCancelled", "1");
  return query;
}

function amountRangeInvalid(draft: OrdersFilterDraft) {
  const min = Number(draft.minTotal);
  const max = Number(draft.maxTotal);
  const minSet = draft.minTotal.trim().length > 0;
  const maxSet = draft.maxTotal.trim().length > 0;
  if ((!minSet && !maxSet) || Number.isNaN(min) || Number.isNaN(max)) return false;
  return minSet && maxSet && min > max;
}

export function OrdersFilterDrawer({ values }: { values: OrdersFilterValues }) {
  const t = useTranslations();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OrdersFilterDraft>(() =>
    createDraftFromValues(values),
  );
  const [count, setCount] = useState<number | null>(null);
  const [countPending, setCountPending] = useState(false);

  const openDrawer = useCallback(() => {
    setDraft(createDraftFromValues(values));
    setOpen(true);
  }, [values]);

  const closeDrawer = useCallback(() => {
    setDraft(createDraftFromValues(values));
    setOpen(false);
  }, [values]);

  const dateRangeError = draft.timePreset !== "all" &&
    !isOrderDateRangeValid(draft.from, draft.to);
  const invalidAmount = amountRangeInvalid(draft);
  const invalid = dateRangeError || invalidAmount;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusElements = () => collectFocusableElements(panel);
    window.requestAnimationFrame(() => {
      focusElements()[0]?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const index = focusable.indexOf(active as HTMLElement);
      const nextIndex = event.shiftKey
        ? index <= 0 ? focusable.length - 1 : index - 1
        : index === focusable.length - 1 || index === -1
          ? 0
          : index + 1;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, open]);

  const runOrderCountQuery = useCallback(() => {
    const nextRequest = ++requestId.current;
    const controller = new AbortController();
    setCountPending(true);

    const timer = window.setTimeout(async () => {
      const query = createFilterCountQuery(draft, values.q);
      try {
        const response = await fetch(`/api/orders/count?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { total?: unknown };
        };
        if (
          nextRequest !== requestId.current ||
          !response.ok ||
          !payload.ok ||
          typeof payload.data?.total !== "number"
        ) {
          throw new Error("request_failed");
        }
        setCount(payload.data.total);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (nextRequest === requestId.current) setCount(null);
      } finally {
        if (nextRequest === requestId.current && !controller.signal.aborted) {
          setCountPending(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, values.q]);

  useEffect(() => {
    if (!open || invalid) return;
    const debounceTimer = window.setTimeout(() => {
      void runOrderCountQuery();
    }, 250);
    return () => window.clearTimeout(debounceTimer);
  }, [invalid, open, runOrderCountQuery]);

  useEffect(() => {
    if (!open) {
      window.requestAnimationFrame(() => openButtonRef.current?.focus());
    }
  }, [open]);

  function updateDraft(partial: Partial<OrdersFilterDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function selectTimePreset(next: string) {
    const preset = next as OrderTimePreset;
    const range = resolveOrderTimePreset(preset);
    if (!range) {
      updateDraft({
        timePreset: preset,
        from: "",
        to: "",
      });
      return;
    }
    updateDraft({
      timePreset: preset,
      from: range.from,
      to: range.to,
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <form action={Routes.Sales} className="relative w-full max-w-md">
          <input type="hidden" name="tab" value="orders" />
          {values.customerId && (
            <input type="hidden" name="customerId" value={values.customerId} />
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
            <input type="hidden" name="paymentMethod" value={values.paymentMethod} />
          )}
          {values.source !== "all" && (
            <input type="hidden" name="source" value={values.source} />
          )}
          {values.timePreset && (
            <input type="hidden" name="timePreset" value={values.timePreset} />
          )}
          {values.from && <input type="hidden" name="from" value={values.from} />}
          {values.to && <input type="hidden" name="to" value={values.to} />}
          {values.minTotal && <input type="hidden" name="minTotal" value={values.minTotal} />}
          {values.maxTotal && <input type="hidden" name="maxTotal" value={values.maxTotal} />}
          {values.includeCancelled && (
            <input type="hidden" name="includeCancelled" value="1" />
          )}
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
          ref={openButtonRef}
          type="button"
          onClick={openDrawer}
          className="relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-primary-600 bg-surface px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <SlidersHorizontal className="size-4" />
          Lọc
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35"
          role="presentation"
          onMouseDown={closeDrawer}
        >
          <aside
            ref={panelRef}
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
                onClick={closeDrawer}
                aria-label={t("common.close")}
                className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </div>

            <form
              ref={formRef}
              action={Routes.Sales}
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={() => setOpen(false)}
            >
              <input type="hidden" name="tab" value="orders" />
              {values.q && <input type="hidden" name="q" value={values.q} />}
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <FilterSection title="Tìm theo">
                  <LumaEntityPicker
                    label="Khách hàng"
                    name="customerId"
                    labelName="customerLabel"
                    value={draft.customerId}
                    labelValue={draft.customerLabel}
                    queryName="customerLabel"
                    kind="customer"
                    placeholder="Tên hoặc số điện thoại"
                    icon={<Search className="size-4" />}
                    onChange={({ value, label }) =>
                      updateDraft({ customerId: value, customerLabel: label })
                    }
                  />
                  <LumaEntityPicker
                    label="Sản phẩm"
                    name="productId"
                    labelName="productLabel"
                    value={draft.productId}
                    labelValue={draft.productLabel}
                    kind="product"
                    queryName="productLabel"
                    placeholder="Tên, SKU hoặc mã vạch"
                    icon={<Barcode className="size-4" />}
                    onChange={({ value, label }) =>
                      updateDraft({ productId: value, productLabel: label })
                    }
                  />
                </FilterSection>

                <FilterSection title="Thời gian">
                  <LumaWebPicker
                    label="Khoảng thời gian"
                    ariaLabel="Khoảng thời gian"
                    name="timePreset"
                    value={draft.timePreset}
                    options={ORDER_TIME_PRESETS}
                    onChange={selectTimePreset}
                  />
                  {draft.timePreset !== "all" && (
                    <LumaDateRangePicker
                      key={`${open}-${draft.from}-${draft.to}`}
                      fromName="from"
                      toName="to"
                      from={draft.from}
                      to={draft.to}
                      onChange={(nextFrom, nextTo) => {
                        updateDraft({
                          timePreset: "custom",
                          from: nextFrom,
                          to: nextTo,
                        });
                      }}
                      error={dateRangeError ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm." : ""}
                    />
                  )}
                </FilterSection>

                <PickerSection
                  title="Trạng thái đơn"
                  name="status"
                  value={draft.status}
                  onChange={(value) => updateDraft({ status: value })}
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
                  value={draft.payment}
                  onChange={(value) => updateDraft({ payment: value })}
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
                  value={draft.paymentMethod}
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
                  onChange={(value) => updateDraft({ paymentMethod: value })}
                />
                <PickerSection
                  title="Nguồn đơn"
                  name="source"
                  value={draft.source}
                  onChange={(value) => updateDraft({ source: value })}
                  options={sources.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "tiktok_shop"
                          ? "TikTok Shop"
                          : value === "shopee"
                            ? "Shopee"
                            : value === "lazada"
                              ? "Lazada"
                              : value === "tiki"
                                ? "Tiki"
                                : value.toUpperCase(),
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
                    checked={draft.includeCancelled}
                    onChange={(event) =>
                      updateDraft({ includeCancelled: event.target.checked })
                    }
                    className="peer sr-only"
                  />
                  <span className="relative h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-primary-600 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
                </label>

                <FilterSection title="Giá trị đơn">
                  <div className="grid grid-cols-2 gap-3">
                    <LabeledInput
                      label="Từ"
                      name="minTotal"
                      value={draft.minTotal}
                      placeholder="0"
                      suffix="đ"
                      onChange={(event) =>
                        updateDraft({ minTotal: event.target.value })
                      }
                    />
                    <LabeledInput
                      label="Đến"
                      name="maxTotal"
                      value={draft.maxTotal}
                      placeholder="Không giới hạn"
                      suffix="đ"
                      onChange={(event) =>
                        updateDraft({ maxTotal: event.target.value })
                      }
                    />
                  </div>
                  {invalidAmount && (
                    <p className="text-xs font-semibold text-red-600">
                      Giá trị từ không được lớn hơn giá trị đến.
                    </p>
                  )}
                </FilterSection>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-6 py-4">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700"
                >
                  Xóa lọc
                </button>
                <button
                  type="submit"
                  disabled={invalid}
                  aria-busy={countPending && !invalid}
                  className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-live="polite">
                    {invalid || count === null
                      ? "Xem … đơn"
                      : `Xem ${count} đơn`}
                  </span>
                </button>
              </div>

              <input type="hidden" name="tab" value="orders" />
              <input type="hidden" name="customerId" value={draft.customerId} />
              <input type="hidden" name="customerLabel" value={draft.customerLabel} />
              <input type="hidden" name="productId" value={draft.productId} />
              <input type="hidden" name="productLabel" value={draft.productLabel} />
              <input type="hidden" name="status" value={draft.status} />
              <input type="hidden" name="payment" value={draft.payment} />
              <input
                type="hidden"
                name="paymentMethod"
                value={draft.paymentMethod}
              />
              <input type="hidden" name="source" value={draft.source} />
              <input type="hidden" name="timePreset" value={draft.timePreset} />
              <input type="hidden" name="from" value={draft.from} />
              <input type="hidden" name="to" value={draft.to} />
              <input type="hidden" name="minTotal" value={draft.minTotal} />
              <input type="hidden" name="maxTotal" value={draft.maxTotal} />
              {draft.includeCancelled && (
                <input type="hidden" name="includeCancelled" value="1" />
              )}
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
    <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-visible:ring-primary-100">
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

function ChipSection({
  title,
  name,
  value,
  options,
  onChange,
}: {
  title: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange?: (value: string) => void;
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
              checked={value === option.value}
              onChange={(event) =>
                onChange?.(event.currentTarget.value)
              }
              className="peer sr-only"
            />
            <span className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold transition hover:border-primary-300 peer-checked:border-primary-600 peer-checked:bg-primary-50 peer-checked:text-primary-700">
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
  onChange,
}: {
  title: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange?: (value: string) => void;
}) {
  return (
    <FilterSection title={title}>
      <LumaWebPicker
        name={name}
        ariaLabel={title}
        value={value}
        options={options}
        onChange={onChange}
      />
    </FilterSection>
  );
}
