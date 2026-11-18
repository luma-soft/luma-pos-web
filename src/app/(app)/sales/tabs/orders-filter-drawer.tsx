"use client";

import { MoneyInput, type MoneyInputProps } from "@/components/ui/money-input";
import { Toggle } from "@/components/ui/toggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Barcode, ChevronRight, Package, RotateCcw, Search, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FilterTriggerButton, ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
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
import { MobileDateRangeScreen, formatFilterDateRange } from "./filter-mobile-screens";

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

/** Number of conditions shown under the phone filter title (NativeInvoiceFilterState.activeCount). */
function activeConditionCount(draft: OrdersFilterDraft) {
  return [
    Boolean(draft.customerId || draft.customerLabel),
    Boolean(draft.productId || draft.productLabel),
    draft.timePreset !== DEFAULT_TIME_FILTER_PRESET,
    draft.status !== "all",
    draft.payment !== "all",
    draft.paymentMethod !== "all",
    draft.source !== "all",
    Boolean(draft.minTotal.trim()),
    Boolean(draft.maxTotal.trim()),
    draft.includeCancelled,
  ].filter(Boolean).length;
}

export function hasActiveOrderFilters(values: OrdersFilterValues) {
  return Boolean(
    values.customerId ||
      values.customerLabel ||
      values.productId ||
      values.productLabel ||
      values.status !== "all" ||
      values.payment !== "all" ||
      values.paymentMethod !== "all" ||
      values.source !== "all" ||
      values.timePreset !== DEFAULT_TIME_FILTER_PRESET ||
      values.minTotal.trim() ||
      values.maxTotal.trim() ||
      values.includeCancelled,
  );
}

export function OrdersFilterDrawer({ values }: { values: OrdersFilterValues }) {
  const t = useTranslations();
  const router = useRouter();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [dateScreenOpen, setDateScreenOpen] = useState(false);
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
    setDateScreenOpen(false);
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
      // Phones open like the native sheet: no field focused, no focus ring on Cancel.
      if (window.matchMedia("(max-width: 1023px)").matches) return;
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

  // Return focus to the trigger only after the drawer actually closed, not on first render.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (window.matchMedia("(max-width: 1023px)").matches) return;
    window.requestAnimationFrame(() => openButtonRef.current?.focus());
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

  function clearFilters() {
    setDraft(createDraftFromValues({
      ...values,
      customerId: "",
      customerLabel: "",
      productId: "",
      productLabel: "",
      status: "all",
      payment: "all",
      paymentMethod: "all",
      source: "all",
      timePreset: DEFAULT_TIME_FILTER_PRESET,
      from: "",
      to: "",
      minTotal: "",
      maxTotal: "",
      includeCancelled: false,
    }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim()) query.set(key, value);
    }
    router.push(`${Routes.Sales}?${query.toString()}`);
    setOpen(false);
  }

  return (
    <>
      <ListSearchFilterBar
        className="mb-4"
        search={<form action={Routes.Sales}>
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
          <ListSearchInput
            name="q"
            defaultValue={values.q}
            placeholder={t("orders.searchPlaceholder")}
            aria-label={t("common.search")}
          />
        </form>}
        filter={<FilterTriggerButton
          ref={openButtonRef}
          onClick={openDrawer}
          label="Lọc"
          active={hasActiveOrderFilters(values)}
        />}
      />

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
            className="ml-auto flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-surface shadow-2xl max-lg:bg-canvas lg:h-full lg:max-w-md lg:overflow-visible"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* LumaFilterScreenHeader: Cancel, centred title and selected-condition count. */}
            <div className="grid shrink-0 grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-2 bg-canvas px-ios-inset pb-3 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:hidden">
              <button
                type="button"
                onClick={closeDrawer}
                className="min-h-11 justify-self-start text-[17px] font-medium text-ios-accent"
              >
                {t("common.cancel")}
              </button>
              <div className="min-w-0 text-center">
                <h2 className="text-[20px] font-semibold leading-[25px]">{t("mobile.invoices.filters.title")}</h2>
                <p className="mt-[3px] text-[13px] leading-[18px] text-ios-label-secondary">
                  {t("mobile.invoices.filters.selectedCount", { count: activeConditionCount(draft) })}
                </p>
              </div>
              <span aria-hidden="true" />
            </div>
            <div className="flex shrink-0 items-start border-b border-border px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 max-lg:hidden lg:px-6 lg:py-5">
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
              onSubmit={applyFilters}
            >
              <input type="hidden" name="tab" value="orders" />
              {values.q && <input type="hidden" name="q" value={values.q} />}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 max-lg:space-y-ios-section max-lg:pb-6 max-lg:pt-1 lg:space-y-6 lg:px-6 lg:py-5">
                <FilterSection title="Tìm theo" mobileTitle={t("mobile.invoices.filters.findBy")}>
                  <LumaEntityPicker
                    mobileIcon={<UserRound />}
                    label="Khách hàng"
                    name="customerId"
                    labelName="customerLabel"
                    value={draft.customerId}
                    labelValue={draft.customerLabel}
                    kind="customer"
                    placeholder="Tên hoặc số điện thoại"
                    icon={<Search className="size-4" />}
                    onChange={({ value, label }) =>
                      updateDraft({ customerId: value, customerLabel: label })
                    }
                  />
                  <LumaEntityPicker
                    mobileIcon={<Package />}
                    label="Sản phẩm"
                    name="productId"
                    labelName="productLabel"
                    value={draft.productId}
                    labelValue={draft.productLabel}
                    kind="product"
                    placeholder="Tên, SKU hoặc mã vạch"
                    icon={<Barcode className="size-4" />}
                    onChange={({ value, label }) =>
                      updateDraft({ productId: value, productLabel: label })
                    }
                  />
                </FilterSection>

                <FilterSection title="Thời gian" mobileTitle={t("mobile.invoices.filters.time")}>
                  {/* Phones: one row that pushes the date screen (presets + custom dates). */}
                  <button
                    type="button"
                    onClick={() => setDateScreenOpen(true)}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.06] dark:active:bg-white/[0.08] lg:hidden"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] text-ios-label">{t("mobile.invoices.filters.range")}</span>
                      {draft.timePreset !== "all" && (draft.from || draft.to) && (
                        <span className="mt-0.5 block text-[13px] tabular-nums text-ios-label-secondary">
                          {formatFilterDateRange(draft.from, draft.to)}
                        </span>
                      )}
                    </span>
                    <span className="max-w-[50%] truncate text-[17px] text-ios-label-secondary">
                      {ORDER_TIME_PRESETS.find((option) => option.value === draft.timePreset)?.label}
                    </span>
                    <ChevronRight className="-ml-1.5 size-4 shrink-0 text-ios-label-tertiary" strokeWidth={2.4} aria-hidden="true" />
                  </button>
                  {dateScreenOpen && (
                    <MobileDateRangeScreen
                      title={t("mobile.invoices.filters.range")}
                      presets={ORDER_TIME_PRESETS}
                      preset={draft.timePreset}
                      from={draft.from}
                      to={draft.to}
                      resolvePreset={(preset) => resolveOrderTimePreset(preset as OrderTimePreset) ?? null}
                      onApply={({ preset, from, to }) => updateDraft({ timePreset: preset, from, to })}
                      onClose={() => setDateScreenOpen(false)}
                    />
                  )}
                  <div className="space-y-3 max-lg:hidden">
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
                  </div>
                </FilterSection>

                <PickerSection
                  title="Trạng thái đơn"
                  mobileTitle={t("mobile.invoices.filters.statusSection")}
                  rowLabel={t("mobile.invoices.filters.orderStatus")}
                  mobileTrailing={(
                    <IncludeCancelledRow
                      label={t("mobile.invoices.filters.includeCancelled")}
                      checked={draft.includeCancelled}
                      onChange={(checked) => updateDraft({ includeCancelled: checked })}
                    />
                  )}
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
                  mobileTitle={t("mobile.invoices.filters.paymentSection")}
                  rowLabel={t("mobile.invoices.filters.paymentStatus")}
                  mobileTrailing={(
                    <LumaWebPicker
                      name="paymentMethod"
                      ariaLabel={t("mobile.invoices.filters.paymentMethod")}
                      rowLabel={t("mobile.invoices.filters.paymentMethod")}
                      value={draft.paymentMethod}
                      options={paymentMethodOptions}
                      onChange={(value) => updateDraft({ paymentMethod: value })}
                    />
                  )}
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
                {/* Phones pick the method in the Payment group above; the chips stay on desktop. */}
                <div className="max-lg:hidden">
                  <ChipSection
                    title="Phương thức thanh toán"
                    name="paymentMethod"
                    value={draft.paymentMethod}
                    options={paymentMethodOptions}
                    onChange={(value) => updateDraft({ paymentMethod: value })}
                  />
                </div>
                <PickerSection
                  title="Nguồn đơn"
                  mobileTitle={t("mobile.invoices.filters.source")}
                  rowLabel={t("mobile.invoices.filters.source")}
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

                <label className="flex items-center gap-4 border-y border-border py-4 max-lg:hidden min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">
                      Hiện đơn đã hủy
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Mặc định được ẩn khỏi danh sách
                    </span>
                  </span>
                  {draft.includeCancelled && <input type="hidden" name="includeCancelled" value="1" />}
                  <Toggle
                    aria-label="Hiện đơn đã hủy"
                    checked={draft.includeCancelled}
                    onChange={(checked) => updateDraft({ includeCancelled: checked })}
                  />
                </label>

                <FilterSection title="Giá trị đơn" mobileTitle={t("mobile.invoices.filters.orderValue")}>
                  <div className="grid grid-cols-2 gap-3 max-lg:block max-lg:[&>*+*]:bg-[linear-gradient(var(--color-border),var(--color-border))] max-lg:[&>*+*]:bg-[length:calc(100%-16px)_1px] max-lg:[&>*+*]:bg-right-top max-lg:[&>*+*]:bg-no-repeat">
                    <LabeledInput
                      mobileLabel={t("mobile.invoices.filters.minimum")}
                      label="Từ"
                      name="minTotal"
                      value={draft.minTotal}
                      placeholder="0"
                      suffix="đ"
                      onChange={(value) =>
                        updateDraft({ minTotal: value == null ? "" : String(value) })
                      }
                    />
                    <LabeledInput
                      mobileLabel={t("mobile.invoices.filters.maximum")}
                      label="Đến"
                      name="maxTotal"
                      value={draft.maxTotal}
                      placeholder="Không giới hạn"
                      suffix="đ"
                      onChange={(value) =>
                        updateDraft({ maxTotal: value == null ? "" : String(value) })
                      }
                    />
                  </div>
                  {invalidAmount && (
                    <p className="text-xs font-semibold text-red-600 max-lg:px-4 max-lg:pb-2.5 max-lg:text-[13px] max-lg:font-normal">
                      Giá trị từ không được lớn hơn giá trị đến.
                    </p>
                  )}
                </FilterSection>
              </div>

              {/* LumaFilterScreenFooter on phones: tinted Clear, hairline divider, filled result button. */}
              <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] max-lg:flex max-lg:items-center max-lg:gap-3.5 max-lg:border-0 max-lg:px-3 max-lg:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-lg:pt-3 lg:px-6 lg:py-4 lg:pb-4">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700 min-w-11 max-lg:min-h-14 max-lg:min-w-[126px] max-lg:flex-1 max-lg:gap-2 max-lg:rounded-[18px] max-lg:border-0 max-lg:bg-ios-accent/10 max-lg:px-3 max-lg:text-[17px] max-lg:font-semibold max-lg:text-ios-accent lg:min-w-0"
                >
                  <RotateCcw className="size-[18px] lg:hidden" strokeWidth={2.4} aria-hidden="true" />
                  <span className="lg:hidden">{t("mobile.invoices.filters.clear")}</span>
                  <span className="max-lg:hidden">Xóa lọc</span>
                </button>
                <span className="h-[34px] w-px shrink-0 bg-border lg:hidden" aria-hidden="true" />
                <button
                  type="submit"
                  disabled={invalid}
                  aria-busy={countPending && !invalid}
                  className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-w-11 max-lg:min-h-14 max-lg:min-w-[150px] max-lg:flex-1 max-lg:rounded-[18px] max-lg:bg-ios-accent max-lg:px-3 max-lg:text-[16px] max-lg:font-semibold lg:min-w-0"
                >
                  <span aria-live="polite">
                    <span className="lg:hidden">
                      {invalid || count === null
                        ? t("mobile.invoices.filters.resultsPending")
                        : t("mobile.invoices.filters.results", { count })}
                    </span>
                    <span className="max-lg:hidden">
                      {invalid || count === null
                        ? "Xem … đơn"
                        : `Xem ${count} đơn`}
                    </span>
                  </span>
                </button>
              </div>

            </form>
          </aside>
        </div>
      )}
    </>
  );
}

const paymentMethodOptions = paymentMethods.map((value) => ({
  value,
  label:
    value === "all"
      ? "Tất cả"
      : value === "cash"
        ? "Tiền mặt"
        : value === "bank_transfer"
          ? "Chuyển khoản"
          : "Thẻ",
}));

/**
 * Desktop: titled block. Phones: an iOS inset-grouped Form section — grey header
 * and a rounded card whose rows are separated by inset hairlines.
 */
function FilterSection({
  title,
  mobileTitle,
  children,
}: {
  title: string;
  mobileTitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 max-lg:space-y-2">
      <h3 className="text-sm font-extrabold max-lg:hidden">{title}</h3>
      <h3 className="px-4 text-[15px] font-semibold leading-5 text-ios-label-secondary lg:hidden">{mobileTitle ?? title}</h3>
      <div className="space-y-3 max-lg:space-y-0 max-lg:overflow-hidden max-lg:rounded-[26px] max-lg:bg-surface max-lg:[&>*+*]:bg-[linear-gradient(var(--color-border),var(--color-border))] max-lg:[&>*+*]:bg-[length:calc(100%-16px)_1px] max-lg:[&>*+*]:bg-right-top max-lg:[&>*+*]:bg-no-repeat">
        {children}
      </div>
    </section>
  );
}

/** iOS LumaSwitch row ("Hiển thị đơn đã hủy") inside the phone status group. */
function IncludeCancelledRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5 lg:hidden">
      <span className="min-w-0 flex-1 text-[17px] text-ios-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        data-button-radius="pill"
        className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", checked ? "bg-ios-green" : "bg-[rgb(120_120_128/0.16)] dark:bg-[rgb(120_120_128/0.32)]")}
      >
        <span className={cn("absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-[left]", checked ? "left-[22px]" : "left-[2px]")} />
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  mobileLabel,
  icon,
  suffix,
  ...props
}: MoneyInputProps & {
  label: string;
  /** Phones: LumaLabeledNumberInputField `.inline` — label left, amount right. */
  mobileLabel?: string;
  icon?: ReactNode;
  suffix?: string;
}) {
  return (
    <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-visible:ring-primary-100 max-lg:flex max-lg:min-h-11 max-lg:items-center max-lg:gap-3 max-lg:rounded-none max-lg:border-0 max-lg:px-4 max-lg:py-0 max-lg:focus-within:ring-0">
      <span className="block text-xs text-slate-500 max-lg:hidden">{label}</span>
      {mobileLabel && <span className="shrink-0 text-[17px] text-ios-label lg:hidden">{mobileLabel}</span>}
      <span className="flex items-center gap-2 max-lg:min-w-0 max-lg:flex-1 max-lg:gap-1">
        {icon && <span className="text-slate-500">{icon}</span>}
        <MoneyInput
          {...props}
          className="min-w-0 flex-1 border-0 rounded-none px-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 max-lg:text-right max-lg:text-[17px] max-lg:placeholder:text-ios-label-tertiary"
        />
        {suffix && <span className="text-sm font-semibold max-lg:text-[17px] max-lg:font-normal max-lg:text-ios-label-secondary">{suffix}</span>}
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
          <label key={option.value} className="cursor-pointer min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">
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
  mobileTitle,
  rowLabel,
  mobileTrailing,
  name,
  value,
  options,
  onChange,
}: {
  title: string;
  mobileTitle?: string;
  rowLabel?: string;
  /** Extra phone-only rows grouped in the same card (switch, second picker). */
  mobileTrailing?: ReactNode;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange?: (value: string) => void;
}) {
  return (
    <FilterSection title={title} mobileTitle={mobileTitle}>
      <LumaWebPicker
        name={name}
        ariaLabel={title}
        rowLabel={rowLabel}
        value={value}
        options={options}
        onChange={onChange}
      />
      {mobileTrailing && <div className="lg:hidden">{mobileTrailing}</div>}
    </FilterSection>
  );
}
