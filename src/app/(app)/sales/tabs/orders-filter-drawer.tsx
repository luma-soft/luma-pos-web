"use client";

import { Toggle } from "@/components/ui/toggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Barcode, Package, Search, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FilterTriggerButton, ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
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
import { MobileDateRangeScreen } from "./filter-mobile-screens";
import {
  AmountRangeRows,
  ChipSection,
  FilterDrawerFooter,
  FilterSection,
  LabeledInput,
  MobileDateRangeRow,
  MobileFilterHeader,
  MobileSwitchRow,
} from "./filter-drawer-sections";
import { useModalLayer } from "@/components/ui/use-modal-layer";

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

  const layer = useModalLayer({ open, onEscape: closeDrawer, elementRef: panelRef });

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
      if (event.key !== "Tab" || !layer.isTop()) return;
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
  }, [closeDrawer, layer, open]);

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
            <MobileFilterHeader
              title={t("mobile.invoices.filters.title")}
              conditionCount={activeConditionCount(draft)}
              onCancel={closeDrawer}
            />
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
                  <MobileDateRangeRow
                    label={t("mobile.invoices.filters.range")}
                    valueLabel={ORDER_TIME_PRESETS.find((option) => option.value === draft.timePreset)?.label}
                    from={draft.from}
                    to={draft.to}
                    showRange={draft.timePreset !== "all"}
                    onOpen={() => setDateScreenOpen(true)}
                  />
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
                    <MobileSwitchRow
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
                  <AmountRangeRows>
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
                  </AmountRangeRows>
                  {invalidAmount && (
                    <p className="text-xs font-semibold text-red-600 max-lg:px-4 max-lg:pb-2.5 max-lg:text-[13px] max-lg:font-normal">
                      Giá trị từ không được lớn hơn giá trị đến.
                    </p>
                  )}
                </FilterSection>
              </div>

              <FilterDrawerFooter
                onClear={clearFilters}
                invalid={invalid}
                pending={countPending}
                desktopApplyLabel={invalid || count === null ? "Xem … đơn" : `Xem ${count} đơn`}
                mobileApplyLabel={invalid || count === null
                  ? t("mobile.invoices.filters.resultsPending")
                  : t("mobile.invoices.filters.results", { count })}
              />

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
