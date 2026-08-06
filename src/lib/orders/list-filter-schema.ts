import { z } from "zod";
import { isOrderDateRangeValid } from "@/lib/orders/filter-date-range";
import {
  DEFAULT_ORDER_TIME_PRESET,
  ORDER_TIME_PRESETS,
  isOrderTimePreset,
} from "@/lib/orders/filter-date-range";

export const orderDocumentTypes = ["sale", "quote", "booking"] as const;
export const orderStatuses = [
  "all",
  "completed",
  "cancelled",
  "owing",
  "returned",
  "draft",
  "quote",
  "confirmed",
  "delivering",
] as const;
export const orderPaymentStatuses = ["all", "paid", "unpaid", "partial"] as const;
export const orderPaymentMethods = ["all", "cash", "bank_transfer", "card"] as const;
export const orderSources = [
  "all",
  "pos",
  "shopee",
  "tiktok_shop",
  "lazada",
  "tiki",
] as const;

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.string().optional(),
);
const optionalUuid = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.uuid().optional(),
);
const optionalNumber = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? Number(value) : undefined,
  z.number().finite().nonnegative().optional(),
);
const optionalDate = z.preprocess(
  (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
  z.iso.date().optional(),
);
const optionalOrderTimePreset = z.preprocess(
  (value) =>
    typeof value === "string" && isOrderTimePreset(value)
      ? value
      : undefined,
  z.enum(ORDER_TIME_PRESETS.map((preset) => preset.value) as [string, ...string[]]),
);
const booleanParam = z.preprocess(
  (value) => value === true || value === "1" || value === "true",
  z.boolean(),
);
const positiveInteger = (fallback: number, max?: number) => z.preprocess(
  (value) => value == null || value === "" ? fallback : Number(value),
  max == null
    ? z.number().int().positive()
    : z.number().int().positive().max(max),
);

export const orderListFilterSchema = z.object({
  documentType: z.enum(orderDocumentTypes).default("sale"),
  orderId: optionalUuid,
  q: optionalText,
  customerId: optionalUuid,
  productId: optionalUuid,
  projectId: optionalUuid,
  customerQuery: optionalText,
  productQuery: optionalText,
  projectQuery: optionalText,
  status: z.enum(orderStatuses).default("all"),
  payment: z.enum(orderPaymentStatuses).default("all"),
  paymentMethod: z.enum(orderPaymentMethods).default("all"),
  source: z.enum(orderSources).default("all"),
  timePreset: optionalOrderTimePreset.default(DEFAULT_ORDER_TIME_PRESET),
  from: optionalDate,
  to: optionalDate,
  deliveryFrom: optionalDate,
  deliveryTo: optionalDate,
  minTotal: optionalNumber,
  maxTotal: optionalNumber,
  includeCancelled: booleanParam.default(false),
  page: positiveInteger(1),
  pageSize: positiveInteger(20, 100),
}).superRefine((value, context) => {
  if ((value.from || value.to) && !isOrderDateRangeValid(value.from ?? "", value.to ?? "")) {
    context.addIssue({
      code: "custom",
      path: ["from"],
      message: "Khoảng thời gian tạo không hợp lệ hoặc vượt quá 1 năm",
    });
  }
  if (value.deliveryFrom && value.deliveryTo &&
      !isOrderDateRangeValid(value.deliveryFrom, value.deliveryTo)) {
    context.addIssue({
      code: "custom",
      path: ["deliveryFrom"],
      message: "Khoảng ngày giao không hợp lệ hoặc vượt quá 1 năm",
    });
  }
  if (value.minTotal != null && value.maxTotal != null && value.minTotal > value.maxTotal) {
    context.addIssue({
      code: "custom",
      path: ["minTotal"],
      message: "Giá trị từ không được lớn hơn giá trị đến",
    });
  }
});

export function parseOrderListSearchParams(params: URLSearchParams) {
  const input = Object.fromEntries(params);
  if (!input.documentType) {
    input.documentType = input.status === "quote"
      ? "quote"
      : input.status === "confirmed"
        ? "booking"
        : "sale";
  }
  return orderListFilterSchema.safeParse(input);
}
