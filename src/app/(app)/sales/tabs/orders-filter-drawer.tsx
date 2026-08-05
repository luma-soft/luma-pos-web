"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  Barcode,
  CalendarDays,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type OrdersFilterValues = {
  q: string;
  customerQuery: string;
  productQuery: string;
  status: string;
  payment: string;
  paymentMethod: string;
  source: string;
  from: string;
  to: string;
  minTotal: string;
  maxTotal: string;
  includeCancelled: boolean;
};

const orderStatuses = ["all", "completed", "owing", "returned"] as const;
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

function localDateValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultSevenDayRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { from: localDateValue(start), to: localDateValue(end) };
}

export function OrdersFilterDrawer({ values }: { values: OrdersFilterValues }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const initialRange = defaultSevenDayRange();
  const [from, setFrom] = useState(values.from || initialRange.from);
  const [to, setTo] = useState(values.to || initialRange.to);
  const [quickRange, setQuickRangeValue] = useState<
    "today" | "7days" | "30days" | "custom"
  >(values.from || values.to ? "custom" : "7days");

  const hiddenFilters = (
    <>
      {values.customerQuery && (
        <input
          type="hidden"
          name="customerQuery"
          value={values.customerQuery}
        />
      )}
      {values.productQuery && (
        <input type="hidden" name="productQuery" value={values.productQuery} />
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

  function setQuickRange(days: number, range: "today" | "7days" | "30days") {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (days - 1));
    setFrom(localDateValue(start));
    setTo(localDateValue(end));
    setQuickRangeValue(range);
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
                  <LabeledInput
                    label="Khách hàng"
                    name="customerQuery"
                    defaultValue={values.customerQuery}
                    placeholder="Tên hoặc số điện thoại"
                    icon={<Search className="size-4" />}
                  />
                  <LabeledInput
                    label="Sản phẩm"
                    name="productQuery"
                    defaultValue={values.productQuery}
                    placeholder="Tên, SKU hoặc mã vạch"
                    icon={<Barcode className="size-4" />}
                  />
                </FilterSection>

                <FilterSection title="Thời gian">
                  <div className="grid grid-cols-4 gap-2">
                    <QuickRange
                      label="Hôm nay"
                      selected={quickRange === "today"}
                      onClick={() => setQuickRange(1, "today")}
                    />
                    <QuickRange
                      label="7 ngày"
                      selected={quickRange === "7days"}
                      onClick={() => setQuickRange(7, "7days")}
                    />
                    <QuickRange
                      label="30 ngày"
                      selected={quickRange === "30days"}
                      onClick={() => setQuickRange(30, "30days")}
                    />
                    <QuickRange
                      label="Tùy chọn"
                      selected={quickRange === "custom"}
                      onClick={() => setQuickRangeValue("custom")}
                    />
                  </div>
                  <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
                    <CalendarDays className="size-4 text-slate-500" />
                    <input
                      type="date"
                      name="from"
                      value={from}
                      onChange={(event) => {
                        setFrom(event.target.value);
                        setQuickRangeValue("custom");
                      }}
                      className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-xs"
                    />
                    <input
                      type="date"
                      name="to"
                      value={to}
                      onChange={(event) => {
                        setTo(event.target.value);
                        setQuickRangeValue("custom");
                      }}
                      className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-xs"
                    />
                  </div>
                </FilterSection>

                <ChipSection
                  title="Trạng thái đơn"
                  name="status"
                  value={values.status}
                  options={orderStatuses.map((value) => ({
                    value,
                    label:
                      value === "all"
                        ? "Tất cả"
                        : value === "completed"
                          ? "Hoàn tất"
                          : value === "owing"
                            ? "Còn nợ"
                            : "Đã trả hàng",
                  }))}
                />
                <ChipSection
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
                  className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105"
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

function QuickRange({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-lg border px-2 text-xs font-semibold",
        selected
          ? "border-primary-600 bg-primary-50 text-primary-700"
          : "border-border",
      )}
    >
      {label}
    </button>
  );
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
