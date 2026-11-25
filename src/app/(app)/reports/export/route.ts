import { getTranslations } from "next-intl/server";
import { MANAGER_ROLES } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";
import { getReportCustomers, getReportInventory, getReportInvoices, getReportProducts, getReports } from "@/lib/data/reports";
import { isReportPeriod, resolveReportRange } from "@/lib/reports/period";
import { toCsv } from "./csv";

/** Upper bound for one export; larger stores should narrow the period. */
const EXPORT_LIMIT = 20_000;

export async function GET(request: Request) {
  let storeId: string;
  try {
    storeId = (await requireStoreRole(MANAGER_ROLES)).storeId;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const t = await getTranslations("reports.d.csv");
  const url = new URL(request.url);
  const params = url.searchParams;
  const tab = params.get("tab") ?? "overview";
  const requested = params.get("period");
  const period = isReportPeriod(requested) ? requested : "today";
  const range = resolveReportRange(period, params.get("from"), params.get("to"));
  const filters = {
    customerId: params.get("customerId") ?? undefined,
    customer: params.get("customer") ?? undefined,
    q: params.get("q") ?? undefined,
    from: range.from,
    to: range.toExclusive,
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  let header: string[];
  let rows: (string | number | null)[][];

  if (tab === "invoices") {
    const data = await getReportInvoices(storeId, range.rangeDays, filters, 1, EXPORT_LIMIT);
    header = [t("code"), t("date"), t("customer"), t("status"), t("netRevenue"), t("cost"), t("grossProfit"), t("margin"), t("refunds"), t("paid")];
    rows = data.rows.map((row) => [row.code, new Date(row.createdAt).toISOString(), row.customerName, row.status, round(row.total), round(row.cost), round(row.profit), round(row.margin), round(row.refund), round(Number(row.amountPaid))]);
  } else if (tab === "products") {
    const data = await getReportProducts(storeId, range.rangeDays, filters, 1, EXPORT_LIMIT);
    header = [t("product"), t("unit"), t("quantitySold"), t("quantityReturned"), t("netRevenue"), t("cost"), t("grossProfit"), t("margin"), t("share")];
    rows = data.rows.map((row) => [row.productName, row.baseUnit, row.qtySold, row.qtyReturned, round(row.revenue), round(row.cost), round(row.profit), round(row.margin), round(row.contribution)]);
  } else if (tab === "customers") {
    const data = await getReportCustomers(storeId, range.rangeDays, filters, 1, EXPORT_LIMIT);
    header = [t("customer"), t("segment"), t("orders"), t("netRevenue"), t("grossProfit"), t("margin"), t("outstanding"), t("lastPurchase")];
    rows = data.rows.map((row) => [row.customerName, row.customerId ? t(row.segment) : "", row.orderCount, round(row.revenue), round(row.profit), round(row.margin), round(Number(row.remaining)), new Date(row.lastPurchaseAt).toISOString()]);
  } else if (tab === "inventory") {
    const data = await getReportInventory(storeId, range.rangeDays, filters, 1, EXPORT_LIMIT);
    header = [t("product"), t("sku"), t("unit"), t("onHand"), t("stockValue"), t("quantitySold"), t("lastSold")];
    rows = data.rows.map((row) => [row.productName, row.sku, row.baseUnit, row.quantity, round(row.stockValue), row.soldQuantity, row.lastSoldDay]);
  } else {
    const data = await getReports(storeId, range.rangeDays, filters);
    header = [t("date"), t("netRevenue"), t("grossProfit"), t("cost"), t("refunds"), t("orders"), t("returnedOrders")];
    rows = data.byDay.map((row) => [row.day, round(row.revenue), round(row.grossProfit), round(row.costOfGoods), round(row.refundTotal), row.orderCount, row.returnedOrders]);
  }

  const name = `bao-cao-${tab}-${range.fromValue}_${range.toValue}.csv`;
  return new Response(toCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
