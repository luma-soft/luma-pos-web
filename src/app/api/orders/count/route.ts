import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import {
  getOrders,
  type OrderPaymentFilter,
  type OrderPaymentMethodFilter,
  type OrderSourceFilter,
  type OrderStatusFilter,
} from "@/lib/data/orders";

const orderStatuses: OrderStatusFilter[] = [
  "all",
  "completed",
  "cancelled",
  "owing",
  "returned",
  "draft",
  "confirmed",
  "delivering",
];
const paymentStatuses: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];
const paymentMethods: OrderPaymentMethodFilter[] = [
  "all",
  "cash",
  "bank_transfer",
  "card",
];
const sources: OrderSourceFilter[] = [
  "all",
  "pos",
  "shopee",
  "tiktok_shop",
  "lazada",
  "tiki",
];

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const params = new URL(request.url).searchParams;
  const { total } = await getOrders({
    q: optionalText(params, "q"),
    customerId: optionalText(params, "customerId"),
    productId: optionalText(params, "productId"),
    status: enumParam(params, "status", orderStatuses, "all"),
    payment: enumParam(params, "payment", paymentStatuses, "all"),
    paymentMethod: enumParam(params, "paymentMethod", paymentMethods, "all"),
    source: enumParam(params, "source", sources, "all"),
    from: optionalText(params, "from"),
    to: optionalText(params, "to"),
    minTotal: optionalNumber(params, "minTotal"),
    maxTotal: optionalNumber(params, "maxTotal"),
    includeCancelled:
      params.get("includeCancelled") === "1" ||
      params.get("includeCancelled") === "true",
    page: 1,
    pageSize: 1,
  });

  return NextResponse.json(
    { ok: true, data: { total } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function optionalText(params: URLSearchParams, name: string) {
  return params.get(name)?.trim() || undefined;
}

function optionalNumber(params: URLSearchParams, name: string) {
  const raw = params.get(name)?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function enumParam<T extends string>(
  params: URLSearchParams,
  name: string,
  values: readonly T[],
  fallback: T,
) {
  const value = params.get(name) as T | null;
  return value && values.includes(value) ? value : fallback;
}
