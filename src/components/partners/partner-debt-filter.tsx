"use client";

import { CalendarDays } from "lucide-react";
import { Select } from "@/components/ui/select";
import { LumaDateRangePicker } from "@/app/(app)/sales/tabs/filter-drawer-shared";
import {
  DEFAULT_TIME_FILTER_PRESET,
  isOrderDateRangeValid,
} from "@/lib/orders/filter-date-range";

export type PartnerDebtTime = "all" | "today" | "7d" | "30d" | "custom";
export type PartnerDebtKind = "all" | "debt" | "payment" | "adjustment";
export type PartnerDebtFilterValue = {
  time: PartnerDebtTime;
  kind: PartnerDebtKind;
  from: string;
  to: string;
};

export const DEFAULT_PARTNER_DEBT_FILTER: PartnerDebtFilterValue = {
  time: DEFAULT_TIME_FILTER_PRESET,
  kind: "all",
  from: "",
  to: "",
};

const timeOptions = [
  { value: "all", label: "Toàn thời gian" },
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
  { value: "custom", label: "Khoảng thời gian" },
];

const kindOptions = [
  { value: "all", label: "Tất cả giao dịch" },
  { value: "debt", label: "Phát sinh nợ" },
  { value: "payment", label: "Thanh toán" },
  { value: "adjustment", label: "Điều chỉnh" },
];

export function PartnerDebtFilterControl({
  value,
  onChange,
}: {
  value: PartnerDebtFilterValue;
  onChange: (value: PartnerDebtFilterValue) => void;
}) {
  const dateError = value.time === "custom" && !isOrderDateRangeValid(value.from, value.to)
    ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm."
    : "";
  return (
    <div className="rounded-card border border-border-soft bg-surface-2/40 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />Thời gian
          </span>
          <Select
            aria-label="Thời gian công nợ"
            value={value.time}
            onValueChange={(time) => onChange({
              ...value,
              time: time as PartnerDebtTime,
              ...(time === "custom" ? {} : { from: "", to: "" }),
            })}
            options={timeOptions}
            rootClassName="w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-500">Loại giao dịch</span>
          <Select
            aria-label="Loại giao dịch công nợ"
            value={value.kind}
            onValueChange={(kind) => onChange({ ...value, kind: kind as PartnerDebtKind })}
            options={kindOptions}
            rootClassName="w-full"
          />
        </label>
      </div>
      {value.time === "custom" && (
        <div className="mt-3">
          <LumaDateRangePicker
            fromName="partnerDebtFrom"
            toName="partnerDebtTo"
            from={value.from}
            to={value.to}
            error={dateError}
            onChange={(from, to) => onChange({ ...value, from, to })}
          />
        </div>
      )}
    </div>
  );
}

export function matchesPartnerDebtFilter(
  row: { createdAt: string | Date; kind: string },
  filter: PartnerDebtFilterValue,
) {
  if (!matchesKind(row.kind, filter.kind)) return false;
  if (filter.time === "all") return true;
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter.time === "today") return createdAt >= startOfToday;
  if (filter.time === "7d" || filter.time === "30d") {
    const days = filter.time === "7d" ? 7 : 30;
    const from = new Date(startOfToday);
    from.setDate(from.getDate() - (days - 1));
    return createdAt >= from;
  }
  if (!filter.from || !filter.to || !isOrderDateRangeValid(filter.from, filter.to)) return false;
  const from = new Date(`${filter.from}T00:00:00`);
  const to = new Date(`${filter.to}T23:59:59.999`);
  return createdAt >= from && createdAt <= to;
}

function matchesKind(kind: string, selected: PartnerDebtKind) {
  if (selected === "all") return true;
  if (selected === "payment") return kind === "payment";
  if (selected === "adjustment") return kind === "adjustment" || kind === "discount";
  return kind === "sale" || kind === "purchase" || kind === "return";
}
