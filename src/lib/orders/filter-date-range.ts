export const ORDER_TIME_PRESETS = [
  { value: "all", label: "Toàn thời gian" },
  { value: "today", label: "Hôm nay" },
  { value: "yesterday", label: "Hôm qua" },
  { value: "7days", label: "7 ngày gần đây" },
  { value: "30days", label: "30 ngày gần đây" },
  { value: "thisWeek", label: "Tuần này" },
  { value: "lastWeek", label: "Tuần trước" },
  { value: "thisMonth", label: "Tháng này" },
  { value: "lastMonth", label: "Tháng trước" },
  { value: "thisYear", label: "Năm nay" },
  { value: "lastYear", label: "Năm trước" },
  { value: "custom", label: "Tùy chỉnh" },
] as const;

export type OrderTimePreset = (typeof ORDER_TIME_PRESETS)[number]["value"];

// Central default for list time filters. Keep this as the single seam for a
// future store setting that lets each merchant choose their preferred range.
export const DEFAULT_TIME_FILTER_PRESET = "all" satisfies OrderTimePreset;

export const BOOKING_DELIVERY_PRESETS = [
  { value: "all", label: "Tất cả ngày giao" },
  { value: "today", label: "Giao hôm nay" },
  { value: "tomorrow", label: "Giao ngày mai" },
  { value: "thisWeek", label: "Tuần này" },
  { value: "overdue", label: "Quá hạn" },
  { value: "custom", label: "Tùy chỉnh" },
] as const;
export type BookingDeliveryPreset = (typeof BOOKING_DELIVERY_PRESETS)[number]["value"];

export function isBookingDeliveryPreset(value?: string): value is BookingDeliveryPreset {
  return BOOKING_DELIVERY_PRESETS.some((preset) => preset.value === value);
}

export function resolveBookingDeliveryPreset(
  preset: BookingDeliveryPreset,
  now = new Date(),
): OrderDateRange | null {
  if (preset === "custom") return null;
  if (preset === "all") return { from: "", to: "" };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const endOfWeek = addDays(today, 6 - mondayOffset);
  if (preset === "today") {
    const value = localDateValue(today);
    return { from: value, to: value };
  }
  if (preset === "tomorrow") {
    const value = localDateValue(addDays(today, 1));
    return { from: value, to: value };
  }
  if (preset === "thisWeek") {
    return { from: localDateValue(today), to: localDateValue(endOfWeek) };
  }
  return {
    from: "",
    to: localDateValue(addDays(today, -1)),
  };
}

export type OrderDateRange = {
  from: string;
  to: string;
};

export function isOrderTimePreset(value?: string): value is OrderTimePreset {
  return ORDER_TIME_PRESETS.some((preset) => preset.value === value);
}

export function resolveOrderTimePreset(
  preset: OrderTimePreset,
  now = new Date(),
): OrderDateRange | null {
  if (preset === "custom") return null;
  if (preset === "all") return { from: "", to: "" };

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(end, -1);
  const mondayOffset = end.getDay() === 0 ? 6 : end.getDay() - 1;
  const thisWeekStart = addDays(end, -mondayOffset);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const lastWeekStart = addDays(lastWeekEnd, -6);
  const thisMonthStart = new Date(end.getFullYear(), end.getMonth(), 1);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = new Date(
    lastMonthEnd.getFullYear(),
    lastMonthEnd.getMonth(),
    1,
  );

  const range = (() => {
    switch (preset) {
      case "today":
        return { start: end, end };
      case "yesterday":
        return { start: yesterday, end: yesterday };
      case "7days":
        return { start: addDays(end, -6), end };
      case "30days":
        return { start: addDays(end, -29), end };
      case "thisWeek":
        return { start: thisWeekStart, end };
      case "lastWeek":
        return { start: lastWeekStart, end: lastWeekEnd };
      case "thisMonth":
        return { start: thisMonthStart, end };
      case "lastMonth":
        return { start: lastMonthStart, end: lastMonthEnd };
      case "thisYear":
        return { start: new Date(end.getFullYear(), 0, 1), end };
      case "lastYear":
        return {
          start: new Date(end.getFullYear() - 1, 0, 1),
          end: new Date(end.getFullYear() - 1, 11, 31),
        };
    }
  })();

  return {
    from: localDateValue(range.start),
    to: localDateValue(range.end),
  };
}

export function isOrderDateRangeValid(from: string, to: string) {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || end < start) return false;
  return end <= oneYearAfter(start);
}

export function oneYearAfterDateValue(value: string) {
  const date = parseLocalDate(value);
  return date ? localDateValue(oneYearAfter(date)) : undefined;
}

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function oneYearAfter(value: Date) {
  const targetYear = value.getFullYear() + 1;
  const lastDayOfMonth = new Date(targetYear, value.getMonth() + 1, 0).getDate();
  return new Date(
    targetYear,
    value.getMonth(),
    Math.min(value.getDate(), lastDayOfMonth),
  );
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function localDateValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
