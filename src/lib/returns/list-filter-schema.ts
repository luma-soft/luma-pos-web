import { z } from "zod";
import { isOrderDateRangeValid } from "@/lib/orders/filter-date-range";

export const returnReasons = [
  "all",
  "defective",
  "wrong_item",
  "changed_mind",
  "other",
] as const;
export type ReturnReasonFilter = (typeof returnReasons)[number];

export const returnReasonLabels: Record<ReturnReasonFilter, string> = {
  all: "Tất cả",
  defective: "Hàng lỗi",
  wrong_item: "Sai hàng",
  changed_mind: "Đổi ý",
  other: "Khác",
};

export const returnRefundMethods = [
  "all",
  "cash",
  "bank_transfer",
  "debt_deduct",
  "momo",
  "zalopay",
  "vnpay",
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

export const returnListFilterSchema = z.object({
  q: optionalText,
  customerId: optionalUuid,
  productId: optionalUuid,
  orderId: optionalUuid,
  customerQuery: optionalText,
  productQuery: optionalText,
  orderQuery: optionalText,
  reason: z.enum(returnReasons).default("all"),
  refundMethod: z.enum(returnRefundMethods).default("all"),
  warehouseId: optionalUuid,
  warehouseQuery: optionalText,
  from: optionalDate,
  to: optionalDate,
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
      message: "Khoảng thời gian không hợp lệ hoặc vượt quá 1 năm",
    });
  }
  if (value.minTotal != null && value.maxTotal != null && value.minTotal > value.maxTotal) {
    context.addIssue({
      code: "custom",
      path: ["minTotal"],
      message: "Tiền hoàn từ không được lớn hơn tiền hoàn đến",
    });
  }
});

export function parseReturnListSearchParams(params: URLSearchParams) {
  return returnListFilterSchema.safeParse(Object.fromEntries(params));
}
