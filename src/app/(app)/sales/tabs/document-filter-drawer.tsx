"use client";

import { MoneyInput, type MoneyInputProps } from "@/components/ui/money-input";
import { Toggle } from "@/components/ui/toggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Barcode,
  Building2,
  FileText,
  UserRound,
  Warehouse,
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
    warehouseId: values.warehouseId ?? "",
    warehouseLabel: values.warehouseLabel ?? "",
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
  } else if (kind === "quotes" && draft.status && draft.status !== "quote") {
    query.set("status", draft.status);
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

export function DocumentFilterDrawer({
  kind,
  values,
}: {
  kind: DocumentFilterKind;
  values: DocumentFilterValues;
}) {
  const labels = copy[kind];
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
    setOpen(false);
  }, [kind, values]);

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

  useEffect(() => {
    if (!open) {
      window.requestAnimationFrame(() => openButtonRef.current?.focus());
    }
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
          {values.warehouseId && (
            <input type="hidden" name="warehouseId" value={values.warehouseId} />
          )}
          {values.warehouseLabel && (
            <input type="hidden" name="warehouseLabel" value={values.warehouseLabel} />
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
            className="ml-auto flex h-full w-full max-w-md flex-col bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start border-b border-border px-6 py-5">
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
              onSubmit={() => setOpen(false)}
            >
              <input type="hidden" name="tab" value={kind} />
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
                    icon={<UserRound className="size-4" />}
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
                  {kind === "returns" && (
                    <>
                      <LumaEntityPicker
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
                      <LumaEntityPicker
                        label="Kho nhận"
                        name="warehouseId"
                        labelName="warehouseLabel"
                        value={draft.warehouseId}
                        labelValue={draft.warehouseLabel}
                        kind="warehouse"
                        queryName="warehouseLabel"
                        placeholder="Chọn kho nhận"
                        icon={<Warehouse className="size-4" />}
                        onChange={({ value, label }) =>
                          updateDraft({ warehouseId: value, warehouseLabel: label })
                        }
                      />
                    </>
                  )}
                  {kind !== "returns" && (
                    <LumaEntityPicker
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

                <FilterSection title="Thời gian">
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
                </FilterSection>

                {kind === "returns" && (
                  <>
                    <FilterSection title="Lý do trả hàng">
                      <LumaWebPicker
                        name="reason"
                        ariaLabel="Lý do trả hàng"
                        value={draft.reason}
                        options={returnReasons.map((value) => ({
                          value,
                          label: returnReasonLabels[value],
                        }))}
                        onChange={(value) => updateDraft({ reason: value })}
                      />
                    </FilterSection>
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
                    <label className="flex items-center gap-4 border-y border-border py-4 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">
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
                  <FilterSection title="Trạng thái">
                    <LumaWebPicker
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
                    <FilterSection title="Ngày giao">
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
                    </FilterSection>
                    <FilterSection title="Trạng thái">
                      <LumaWebPicker
                        name="status"
                        ariaLabel="Trạng thái đặt hàng"
                        value={draft.status}
                        options={bookingStatusOptions}
                        onChange={(value) => updateDraft({ status: value })}
                      />
                    </FilterSection>
                    <FilterSection title="Trạng thái thanh toán">
                      <LumaWebPicker
                        name="payment"
                        ariaLabel="Trạng thái thanh toán"
                        value={draft.payment}
                        options={paymentStatuses}
                        onChange={(value) => updateDraft({ payment: value })}
                      />
                    </FilterSection>
                  </>
                )}

                <FilterSection title={kind === "returns" ? "Khoảng tiền hoàn" : "Khoảng giá trị"}>
                  <div className="grid grid-cols-2 gap-3">
                    <LabeledInput
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
                  {amountError && (
                    <p className="text-xs font-semibold text-red-600">
                      Giá trị từ không được lớn hơn giá trị đến.
                    </p>
                  )}
                </FilterSection>
              </div>

              <footer className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={closeDrawer}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0"
              >
                  Xóa lọc
                </button>
                <button
                  type="submit"
                  disabled={invalid}
                  aria-busy={countPending && !invalid}
                  className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0"
                >
                  <span aria-live="polite">
                    {invalid || count === null
                      ? `Xem … ${labels.unit}`
                      : `Xem ${count} ${labels.unit}`}
                  </span>
                </button>
              </footer>

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
  suffix,
  ...props
}: MoneyInputProps & {
  label: string;
  suffix?: string;
}) {
  return (
    <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-visible:ring-primary-100">
      <span className="block text-xs text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <MoneyInput
          {...props}
          className="min-w-0 flex-1 border-0 rounded-none px-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
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
  options: Array<{ value: string; label: string }>;
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
              onChange={(event) => onChange?.(event.currentTarget.value)}
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
