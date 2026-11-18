"use client";

import { Toggle } from "@/components/ui/toggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Barcode,
  Building2,
  FileText,
  Package,
  UserRound,
  X,
} from "lucide-react";
import { FilterTriggerButton, ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { Routes } from "@/lib/routes";
import {
  BOOKING_DELIVERY_PRESETS,
  DEFAULT_TIME_FILTER_PRESET,
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
import { bookingStatusOptions, serializeBookingStatus } from "@/lib/orders/booking-status-filter";
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

type DocumentFilterDraft = {
  customerId: string;
  customerLabel: string;
  productId: string;
  productLabel: string;
  projectId: string;
  projectLabel: string;
  projectQuery: string;
  orderId: string;
  orderLabel: string;
  warehouseId: string;
  warehouseLabel: string;
  timePreset: OrderTimePreset | "custom";
  from: string;
  to: string;
  deliveryPreset: BookingDeliveryPreset | "custom" | "all";
  deliveryFrom: string;
  deliveryTo: string;
  status: string;
  payment: string;
  reason: string;
  refundMethod: string;
  minTotal: string;
  maxTotal: string;
  includeCancelled: boolean;
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

function createDraftFromValues(kind: DocumentFilterKind, values: DocumentFilterValues): DocumentFilterDraft {
  const basePreset = isOrderTimePreset(values.timePreset)
    ? values.timePreset
    : DEFAULT_TIME_FILTER_PRESET;
  const range = resolveOrderTimePreset(basePreset) ??
    resolveOrderTimePreset(DEFAULT_TIME_FILTER_PRESET)!;

  const draft: DocumentFilterDraft = {
    customerId: values.customerId ?? "",
    customerLabel: values.customerLabel ?? "",
    productId: values.productId ?? "",
    productLabel: values.productLabel ?? "",
    projectId: values.projectId ?? "",
    projectLabel: values.projectLabel ?? "",
    projectQuery: values.projectQuery ?? "",
    orderId: values.orderId ?? "",
    orderLabel: values.orderLabel ?? "",
    warehouseId: "",
    warehouseLabel: "",
    timePreset: isOrderTimePreset(values.timePreset) && values.timePreset !== "all"
      ? values.timePreset
      : values.timePreset === "all"
        ? "all"
        : values.from || values.to
          ? "custom"
          : DEFAULT_TIME_FILTER_PRESET,
    from: values.from || range.from,
    to: values.to || range.to,
    deliveryPreset: "all",
    deliveryFrom: "",
    deliveryTo: "",
    status: "quote",
    payment: "all",
    reason: "all",
    refundMethod: "all",
    minTotal: values.minTotal ?? "",
    maxTotal: values.maxTotal ?? "",
    includeCancelled: values.includeCancelled ?? false,
  };

  if (kind === "bookings") {
    const nextPreset = isBookingDeliveryPreset(values.deliveryPreset)
      ? values.deliveryPreset
      : values.deliveryFrom || values.deliveryTo
        ? "custom"
        : "all";
    const nextRange = resolveBookingDeliveryPreset(nextPreset) ?? {
      from: values.deliveryFrom ?? "",
      to: values.deliveryTo ?? "",
    };
    return {
      ...draft,
      timePreset: basePreset,
      from: values.from || range.from,
      to: values.to || range.to,
      deliveryPreset: nextPreset,
      deliveryFrom: nextRange.from,
      deliveryTo: nextRange.to,
      status: values.status ?? "all",
      payment: values.payment ?? "all",
    };
  }

  if (kind === "returns") {
    return {
      ...draft,
      timePreset: basePreset,
      from: values.from || range.from,
      to: values.to || range.to,
      reason: values.reason ?? "all",
      refundMethod: values.refundMethod ?? "all",
      status: "all",
      payment: "all",
    };
  }

  return {
    ...draft,
    timePreset: basePreset,
    from: values.from || range.from,
    to: values.to || range.to,
    status: values.status ?? "quote",
  };
}

function createFilterCountQuery(kind: DocumentFilterKind, draft: DocumentFilterDraft, searchText: string) {
  const query = new URLSearchParams();
  if (searchText.trim()) query.set("q", searchText.trim());
  if (draft.customerId) query.set("customerId", draft.customerId);
  if (draft.customerLabel) query.set("customerLabel", draft.customerLabel);
  if (draft.productId) query.set("productId", draft.productId);
  if (draft.productLabel) query.set("productLabel", draft.productLabel);
  if (kind === "quotes" || kind === "bookings") {
    if (draft.projectId) query.set("projectId", draft.projectId);
    if (draft.projectLabel) query.set("projectLabel", draft.projectLabel);
    if (draft.projectQuery) query.set("projectQuery", draft.projectQuery);
  }
  if (kind === "returns") {
    if (draft.orderId) query.set("orderId", draft.orderId);
    if (draft.orderLabel) query.set("orderLabel", draft.orderLabel);
    if (draft.warehouseId) query.set("warehouseId", draft.warehouseId);
    if (draft.warehouseLabel) query.set("warehouseLabel", draft.warehouseLabel);
    if (draft.reason !== "all") query.set("reason", draft.reason);
    if (draft.refundMethod !== "all") query.set("refundMethod", draft.refundMethod);
  }
  if (kind === "bookings") {
    if (draft.deliveryPreset !== "all") {
      query.set("deliveryPreset", draft.deliveryPreset);
    }
    if (draft.deliveryFrom) query.set("deliveryFrom", draft.deliveryFrom);
    if (draft.deliveryTo) query.set("deliveryTo", draft.deliveryTo);
    const status = serializeBookingStatus(draft.status);
    if (status) query.set(...status);
    if (draft.payment && draft.payment !== "all") query.set("payment", draft.payment);
  } else if (kind === "quotes") {
    // The quotes list defaults to open quotes ("quote"); the count API defaults to
    // "all", so the status must always be sent or the count includes converted quotes.
    query.set("status", draft.status || "quote");
  }
  if (draft.timePreset !== DEFAULT_TIME_FILTER_PRESET || draft.from || draft.to) {
    query.set("timePreset", draft.timePreset);
  }
  if (draft.from) query.set("from", draft.from);
  if (draft.to) query.set("to", draft.to);
  if (draft.minTotal.trim()) query.set("minTotal", draft.minTotal.trim());
  if (draft.maxTotal.trim()) query.set("maxTotal", draft.maxTotal.trim());
  if (draft.includeCancelled) query.set("includeCancelled", "1");

  if (kind === "quotes") {
    query.set("documentType", "quote");
  }
  if (kind === "bookings") {
    query.set("documentType", "booking");
  }
  return query;
}

function amountRangeInvalid(draft: DocumentFilterDraft) {
  const min = Number(draft.minTotal);
  const max = Number(draft.maxTotal);
  const hasMin = draft.minTotal.trim().length > 0;
  const hasMax = draft.maxTotal.trim().length > 0;
  if ((!hasMin && !hasMax) || Number.isNaN(min) || Number.isNaN(max)) return false;
  return hasMin && hasMax && min > max;
}

/** Phone header count (NativeInvoiceFilterState / NativeReturnsFilterState activeCount). */
function activeConditionCount(kind: DocumentFilterKind, draft: DocumentFilterDraft) {
  return [
    Boolean(draft.customerId || draft.customerLabel),
    Boolean(draft.productId || draft.productLabel),
    kind !== "returns" && Boolean(draft.projectId || draft.projectLabel || draft.projectQuery),
    kind === "returns" && Boolean(draft.orderId || draft.orderLabel),
    draft.timePreset !== DEFAULT_TIME_FILTER_PRESET,
    kind === "bookings" && draft.deliveryPreset !== "all",
    kind === "quotes" && draft.status !== "quote",
    kind === "bookings" && draft.status !== "all",
    kind === "bookings" && draft.payment !== "all",
    kind === "returns" && draft.reason !== "all",
    kind === "returns" && draft.refundMethod !== "all",
    Boolean(draft.minTotal.trim()),
    Boolean(draft.maxTotal.trim()),
    draft.includeCancelled,
  ].filter(Boolean).length;
}

const mobileTitleKey = {
  returns: "mobile.invoices.filters.titleReturns",
  quotes: "mobile.invoices.filters.titleQuotes",
  bookings: "mobile.invoices.filters.titleBookings",
} as const;

export function hasActiveDocumentFilters(
  kind: DocumentFilterKind,
  values: DocumentFilterValues,
) {
  const commonActive = Boolean(
    values.customerId ||
      values.customerLabel ||
      values.productId ||
      values.productLabel ||
      values.timePreset !== DEFAULT_TIME_FILTER_PRESET ||
      values.minTotal.trim() ||
      values.maxTotal.trim(),
  );
  if (commonActive) return true;

  if (kind === "returns") {
    return Boolean(
      values.orderId ||
        values.orderLabel ||
        (values.reason && values.reason !== "all") ||
        (values.refundMethod && values.refundMethod !== "all") ||
        values.includeCancelled,
    );
  }

  const projectActive = Boolean(
    values.projectId || values.projectLabel || values.projectQuery,
  );
  if (kind === "quotes") {
    return projectActive || Boolean(values.status && values.status !== "quote");
  }
  return Boolean(
    projectActive ||
      (values.deliveryPreset && values.deliveryPreset !== "all") ||
      (values.status && values.status !== "all") ||
      (values.payment && values.payment !== "all"),
  );
}

export function DocumentFilterDrawer({
  kind,
  values,
}: {
  kind: DocumentFilterKind;
  values: DocumentFilterValues;
}) {
  const router = useRouter();
  const t = useTranslations();
  const labels = copy[kind];
  const [dateScreen, setDateScreen] = useState<"created" | "delivery" | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const requestId = useRef(0);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DocumentFilterDraft>(() =>
    createDraftFromValues(kind, values),
  );
  const [count, setCount] = useState<number | null>(null);
  const [countPending, setCountPending] = useState(false);
  const timeRangeError = draft.timePreset !== "all" &&
    !isOrderDateRangeValid(draft.from, draft.to);

  const deliveryRangeError = kind === "bookings" &&
    draft.deliveryPreset !== "all" &&
    draft.deliveryPreset !== "overdue" &&
    !isOrderDateRangeValid(draft.deliveryFrom, draft.deliveryTo);

  const amountError = amountRangeInvalid(draft);
  const invalid = timeRangeError || deliveryRangeError || amountError;

  const openDrawer = useCallback(() => {
    setDraft(createDraftFromValues(kind, values));
    setOpen(true);
  }, [kind, values]);

  const closeDrawer = useCallback(() => {
    setDraft(createDraftFromValues(kind, values));
    setDateScreen(null);
    setOpen(false);
  }, [kind, values]);

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

  const runDocumentCountQuery = useCallback(() => {
    const nextRequest = ++requestId.current;
    const controller = new AbortController();
    setCountPending(true);

    const timer = window.setTimeout(async () => {
      const query = createFilterCountQuery(kind, draft, values.q);
      const endpoint = kind === "returns"
        ? "/api/returns/count"
        : "/api/orders/count";
      try {
        const response = await fetch(`${endpoint}?${query}`, {
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
  }, [kind, draft, values.q]);

  useEffect(() => {
    if (!open || invalid) return;
    const debounceTimer = window.setTimeout(() => {
      void runDocumentCountQuery();
    }, 250);
    return () => window.clearTimeout(debounceTimer);
  }, [invalid, open, runDocumentCountQuery]);

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

  function updateDraft(partial: Partial<DocumentFilterDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function selectTimePreset(next: string) {
    const preset = next as OrderTimePreset | "custom";
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

  function selectDeliveryPreset(next: string) {
    const preset = next as BookingDeliveryPreset | "custom";
    const range = resolveBookingDeliveryPreset(preset);
    if (!range) {
      updateDraft({
        deliveryPreset: preset,
        deliveryFrom: "",
        deliveryTo: "",
      });
      return;
    }
    updateDraft({
      deliveryPreset: preset,
      deliveryFrom: range.from,
      deliveryTo: range.to,
    });
  }

  function clearFilters() {
    setDraft(createDraftFromValues(kind, {
      q: values.q,
      customerId: "",
      customerLabel: "",
      productId: "",
      productLabel: "",
      timePreset: DEFAULT_TIME_FILTER_PRESET,
      from: "",
      to: "",
      minTotal: "",
      maxTotal: "",
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
          <input type="hidden" name="tab" value={kind} />
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
          {values.projectId && (
            <input type="hidden" name="projectId" value={values.projectId} />
          )}
          {values.projectLabel && (
            <input type="hidden" name="projectLabel" value={values.projectLabel} />
          )}
          {values.projectQuery && (
            <input type="hidden" name="projectQuery" value={values.projectQuery} />
          )}
          {values.orderId && (
            <input type="hidden" name="orderId" value={values.orderId} />
          )}
          {values.orderLabel && (
            <input type="hidden" name="orderLabel" value={values.orderLabel} />
          )}
          {values.timePreset && <input type="hidden" name="timePreset" value={values.timePreset} />}
          {values.deliveryPreset && (
            <input type="hidden" name="deliveryPreset" value={values.deliveryPreset} />
          )}
          {values.deliveryFrom && (
            <input type="hidden" name="deliveryFrom" value={values.deliveryFrom} />
          )}
          {values.deliveryTo && (
            <input type="hidden" name="deliveryTo" value={values.deliveryTo} />
          )}
          {values.reason && values.reason !== "all" && (
            <input type="hidden" name="reason" value={values.reason} />
          )}
          {values.refundMethod && values.refundMethod !== "all" && (
            <input type="hidden" name="refundMethod" value={values.refundMethod} />
          )}
          {values.status && values.status !== "quote" && (
            <input type="hidden" name="status" value={values.status} />
          )}
          {values.payment && values.payment !== "all" && (
            <input type="hidden" name="payment" value={values.payment} />
          )}
          {values.minTotal && (
            <input type="hidden" name="minTotal" value={values.minTotal} />
          )}
          {values.maxTotal && (
            <input type="hidden" name="maxTotal" value={values.maxTotal} />
          )}
          {values.includeCancelled && (
            <input type="hidden" name="includeCancelled" value="1" />
          )}
          <ListSearchInput
            name="q"
            defaultValue={values.q}
            placeholder={labels.search}
            aria-label="Tìm kiếm"
          />
        </form>}
        filter={<FilterTriggerButton
          ref={openButtonRef}
          onClick={openDrawer}
          label="Lọc"
          hideLabelOnSmallScreens
          active={hasActiveDocumentFilters(kind, values)}
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
            aria-labelledby={`${kind}-filter-title`}
            className="ml-auto flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-surface shadow-2xl max-lg:bg-canvas lg:h-full lg:max-w-md lg:overflow-visible"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <MobileFilterHeader
              title={t(mobileTitleKey[kind])}
              conditionCount={activeConditionCount(kind, draft)}
              onCancel={closeDrawer}
            />
            <header className="flex shrink-0 items-start border-b border-border px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 max-lg:hidden lg:px-6 lg:py-5">
              <div className="min-w-0 flex-1">
                <h2
                  id={`${kind}-filter-title`}
                  className="text-lg font-extrabold text-slate-900 dark:text-slate-100"
                >
                  {labels.title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {labels.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Đóng"
                className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </header>

            <form
              ref={formRef}
              action={Routes.Sales}
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={applyFilters}
            >
              <input type="hidden" name="tab" value={kind} />
              {values.q && <input type="hidden" name="q" value={values.q} />}

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 max-lg:space-y-ios-section max-lg:pb-6 max-lg:pt-1 lg:space-y-6 lg:px-6 lg:py-5">
                <FilterSection
                  title="Tìm theo"
                  mobileTitle={t(kind === "returns" ? "mobile.invoices.filters.partySection" : "mobile.invoices.filters.findBy")}
                >
                  <LumaEntityPicker
                    mobileIcon={<UserRound />}
                    label="Khách hàng"
                    name="customerId"
                    labelName="customerLabel"
                    value={draft.customerId}
                    labelValue={draft.customerLabel}
                    queryName="customerLabel"
                    kind="customer"
                    placeholder="Tên hoặc số điện thoại"
                    icon={<UserRound className="size-4" />}
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
                    queryName="productLabel"
                    placeholder="Tên, SKU hoặc mã vạch"
                    icon={<Barcode className="size-4" />}
                    onChange={({ value, label }) =>
                      updateDraft({ productId: value, productLabel: label })
                    }
                  />
                  {kind === "returns" && (
                    <>
                      <LumaEntityPicker
                        mobileIcon={<FileText />}
                        label="Đơn gốc"
                        name="orderId"
                        labelName="orderLabel"
                        value={draft.orderId}
                        labelValue={draft.orderLabel}
                        kind="order"
                        queryName="orderLabel"
                        placeholder="Chọn đơn bán gốc"
                        icon={<FileText className="size-4" />}
                        onChange={({ value, label }) =>
                          updateDraft({ orderId: value, orderLabel: label })
                        }
                      />
                    </>
                  )}
                  {kind !== "returns" && (
                    <LumaEntityPicker
                      mobileIcon={<Building2 />}
                      label="Công trình"
                      name="projectId"
                      labelName="projectLabel"
                      value={draft.projectId}
                      labelValue={draft.projectLabel}
                      queryName="projectQuery"
                      kind="project"
                      placeholder="Chọn công trình"
                      icon={<Building2 className="size-4" />}
                      onChange={({ value, label }) =>
                        updateDraft({ projectId: value, projectLabel: label, projectQuery: label })
                      }
                    />
                  )}
                </FilterSection>

                <FilterSection title="Thời gian" mobileTitle={t("mobile.invoices.filters.time")}>
                  <MobileDateRangeRow
                    label={t("mobile.invoices.filters.range")}
                    valueLabel={ORDER_TIME_PRESETS.find((option) => option.value === draft.timePreset)?.label}
                    from={draft.from}
                    to={draft.to}
                    showRange={draft.timePreset !== "all"}
                    onOpen={() => setDateScreen("created")}
                  />
                  <div className="space-y-3 max-lg:hidden">
                  <LumaWebPicker
                    name="timePreset"
                    ariaLabel="Khoảng thời gian"
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
                      error={
                        timeRangeError
                          ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm"
                          : ""
                      }
                    />
                  )}
                  </div>
                </FilterSection>

                {kind === "returns" && (
                  <>
                    <FilterSection title="Lý do trả hàng" mobileTitle={t("mobile.invoices.filters.returnSection")}>
                      <LumaWebPicker
                        rowLabel={t("mobile.invoices.filters.reason")}
                        name="reason"
                        ariaLabel="Lý do trả hàng"
                        value={draft.reason}
                        options={returnReasons.map((value) => ({
                          value,
                          label: returnReasonLabels[value],
                        }))}
                        onChange={(value) => updateDraft({ reason: value })}
                      />
                      {/* Phones keep the refund method and cancelled switch in this card. */}
                      <div className="lg:hidden">
                        <LumaWebPicker
                          rowLabel={t("mobile.invoices.filters.refundMethod")}
                          name="refundMethod"
                          ariaLabel={t("mobile.invoices.filters.refundMethod")}
                          value={draft.refundMethod}
                          options={returnRefundMethods.map((value) => ({
                            value,
                            label: refundMethodLabels[value],
                          }))}
                          onChange={(value) => updateDraft({ refundMethod: value })}
                        />
                      </div>
                      <MobileSwitchRow
                        label={t("mobile.invoices.filters.includeCancelledReturns")}
                        checked={draft.includeCancelled}
                        onChange={(checked) => updateDraft({ includeCancelled: checked })}
                      />
                    </FilterSection>
                    <div className="max-lg:hidden">
                    <ChipSection
                      title="Phương thức hoàn tiền"
                      name="refundMethod"
                      value={draft.refundMethod}
                      options={returnRefundMethods.map((value) => ({
                        value,
                        label: refundMethodLabels[value],
                      }))}
                      onChange={(value) => updateDraft({ refundMethod: value })}
                    />
                    </div>
                    <label className="flex items-center gap-4 border-y border-border py-4 max-lg:hidden min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold">
                          Hiện phiếu đã hủy
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          Mặc định được ẩn khỏi danh sách
                        </span>
                      </span>
                      {draft.includeCancelled && <input type="hidden" name="includeCancelled" value="1" />}
                      <Toggle
                        aria-label="Hiện phiếu đã hủy"
                        checked={draft.includeCancelled}
                        onChange={(checked) => updateDraft({ includeCancelled: checked })}
                      />
                    </label>
                  </>
                )}

                {kind === "quotes" && (
                  <FilterSection title="Trạng thái" mobileTitle={t("mobile.invoices.filters.statusSection")}>
                    <LumaWebPicker
                      rowLabel={t("mobile.invoices.filters.quoteStatus")}
                      name="status"
                      ariaLabel="Trạng thái báo giá"
                      value={draft.status}
                      options={quoteStatuses}
                      onChange={(value) => updateDraft({ status: value })}
                    />
                  </FilterSection>
                )}

                {kind === "bookings" && (
                  <>
                    <FilterSection title="Ngày giao" mobileTitle={t("mobile.invoices.filters.deliverySection")}>
                      <MobileDateRangeRow
                        label={t("mobile.invoices.filters.deliveryRange")}
                        valueLabel={BOOKING_DELIVERY_PRESETS.find((option) => option.value === draft.deliveryPreset)?.label}
                        from={draft.deliveryFrom}
                        to={draft.deliveryTo}
                        showRange={draft.deliveryPreset !== "all" && draft.deliveryPreset !== "overdue"}
                        onOpen={() => setDateScreen("delivery")}
                      />
                      <div className="space-y-3 max-lg:hidden">
                      <LumaWebPicker
                        name="deliveryPreset"
                        ariaLabel="Khoảng ngày giao"
                        value={draft.deliveryPreset}
                        options={BOOKING_DELIVERY_PRESETS}
                        onChange={selectDeliveryPreset}
                      />
                      {draft.deliveryPreset !== "all" && draft.deliveryPreset !== "overdue" && (
                    <LumaDateRangePicker
                      key={`${open}-${draft.deliveryFrom}-${draft.deliveryTo}`}
                      fromName="deliveryFrom"
                      toName="deliveryTo"
                      from={draft.deliveryFrom}
                          to={draft.deliveryTo}
                          onChange={(nextFrom, nextTo) => {
                            updateDraft({
                              deliveryPreset: "custom",
                              deliveryFrom: nextFrom,
                              deliveryTo: nextTo,
                            });
                          }}
                          error={
                            deliveryRangeError
                              ? "Khoảng ngày giao không hợp lệ hoặc vượt quá 1 năm"
                              : ""
                          }
                        />
                      )}
                      </div>
                    </FilterSection>
                    <FilterSection title="Trạng thái" mobileTitle={t("mobile.invoices.filters.statusSection")}>
                      <LumaWebPicker
                        rowLabel={t("mobile.invoices.filters.bookingStatus")}
                        name="status"
                        ariaLabel="Trạng thái đặt hàng"
                        value={draft.status}
                        options={bookingStatusOptions}
                        onChange={(value) => updateDraft({ status: value })}
                      />
                    </FilterSection>
                    <FilterSection title="Trạng thái thanh toán" mobileTitle={t("mobile.invoices.filters.paymentSection")}>
                      <LumaWebPicker
                        rowLabel={t("mobile.invoices.filters.paymentStatus")}
                        name="payment"
                        ariaLabel="Trạng thái thanh toán"
                        value={draft.payment}
                        options={paymentStatuses}
                        onChange={(value) => updateDraft({ payment: value })}
                      />
                    </FilterSection>
                  </>
                )}

                <FilterSection
                  title={kind === "returns" ? "Khoảng tiền hoàn" : "Khoảng giá trị"}
                  mobileTitle={t(kind === "returns" ? "mobile.invoices.filters.refundAmount" : "mobile.invoices.filters.orderValue")}
                >
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
                  {amountError && (
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
                desktopApplyLabel={invalid || count === null ? `Xem … ${labels.unit}` : `Xem ${count} ${labels.unit}`}
                mobileApplyLabel={kind === "returns"
                  ? invalid || count === null
                    ? t("mobile.invoices.filters.resultCountPending")
                    : t("mobile.invoices.filters.resultCount", { count })
                  : invalid || count === null
                    ? t("mobile.invoices.filters.resultsPending")
                    : t("mobile.invoices.filters.results", { count })}
              />
              {dateScreen === "created" && (
                <MobileDateRangeScreen
                  title={t("mobile.invoices.filters.range")}
                  presets={ORDER_TIME_PRESETS}
                  preset={draft.timePreset}
                  from={draft.from}
                  to={draft.to}
                  resolvePreset={(preset) => resolveOrderTimePreset(preset as OrderTimePreset) ?? null}
                  onApply={({ preset, from, to }) => updateDraft({ timePreset: preset as OrderTimePreset | "custom", from, to })}
                  onClose={() => setDateScreen(null)}
                />
              )}
              {dateScreen === "delivery" && (
                <MobileDateRangeScreen
                  title={t("mobile.invoices.filters.deliveryRange")}
                  presets={BOOKING_DELIVERY_PRESETS}
                  preset={draft.deliveryPreset}
                  from={draft.deliveryFrom}
                  to={draft.deliveryTo}
                  resolvePreset={(preset) => resolveBookingDeliveryPreset(preset as BookingDeliveryPreset)}
                  onApply={({ preset, from, to }) => updateDraft({ deliveryPreset: preset as BookingDeliveryPreset, deliveryFrom: from, deliveryTo: to })}
                  onClose={() => setDateScreen(null)}
                />
              )}

              <input type="hidden" name="tab" value={kind} />
              <input type="hidden" name="customerId" value={draft.customerId} />
              <input type="hidden" name="customerLabel" value={draft.customerLabel} />
              <input type="hidden" name="productId" value={draft.productId} />
              <input type="hidden" name="productLabel" value={draft.productLabel} />
              {kind !== "returns" && (
                <>
                  <input type="hidden" name="projectId" value={draft.projectId} />
                  <input type="hidden" name="projectLabel" value={draft.projectLabel} />
                  <input type="hidden" name="projectQuery" value={draft.projectQuery} />
                </>
              )}
              {kind === "returns" && (
                <>
                  <input type="hidden" name="orderId" value={draft.orderId} />
                  <input type="hidden" name="orderLabel" value={draft.orderLabel} />
                  <input type="hidden" name="warehouseId" value={draft.warehouseId} />
                  <input
                    type="hidden"
                    name="warehouseLabel"
                    value={draft.warehouseLabel}
                  />
                </>
              )}
              <input type="hidden" name="timePreset" value={draft.timePreset} />
              <input type="hidden" name="from" value={draft.from} />
              <input type="hidden" name="to" value={draft.to} />
              {kind === "bookings" && (
                <>
                  <input
                    type="hidden"
                    name="deliveryPreset"
                    value={draft.deliveryPreset}
                  />
                  {draft.deliveryPreset !== "overdue" && (
                    <input type="hidden" name="deliveryFrom" value={draft.deliveryFrom} />
                  )}
                  <input type="hidden" name="deliveryTo" value={draft.deliveryTo} />
                </>
              )}
              {kind !== "returns" && (
                <input type="hidden" name="status" value={draft.status} />
              )}
              {kind === "bookings" && (
                <input type="hidden" name="payment" value={draft.payment} />
              )}
              {kind === "returns" && (
                <>
                  <input type="hidden" name="reason" value={draft.reason} />
                  <input type="hidden" name="refundMethod" value={draft.refundMethod} />
                </>
              )}
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
