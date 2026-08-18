import { getReportCustomers, getReportInvoices, getReportProducts, getReports } from "@/lib/data/reports";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

function reportRange(request: Request) {
  const range = searchParam(request, "range", "month");
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  let from = new Date(today.getFullYear(), today.getMonth(), 1);
  let to = tomorrow;

  if (range === "today") from = today;
  else if (range === "week") from = addDays(today, -6);
  else if (range === "custom") {
    const url = new URL(request.url);
    const customFrom = parseDate(url.searchParams.get("from"));
    const customTo = parseDate(url.searchParams.get("to"));
    if (customFrom && customTo && customFrom <= customTo) {
      from = customFrom;
      to = addDays(customTo, 1);
    } else {
      from = addDays(today, -(Math.max(1, numberParam(request, "days", 30)) - 1));
    }
  }

  return {
    rangeDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
    filters: { from, to },
  };
}

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const range = reportRange(request);
  const tab = searchParam(request, "tab", "overview");
  const [report, details] = await Promise.all([
    getReports(gate.storeId, range.rangeDays, range.filters),
    tab === "orders"
      ? getReportInvoices(gate.storeId, range.rangeDays, range.filters, 1, 20)
      : tab === "products"
        ? getReportProducts(gate.storeId, range.rangeDays, range.filters, 1, 20)
        : tab === "customers"
          ? getReportCustomers(gate.storeId, range.rangeDays, range.filters, 1, 20)
          : Promise.resolve(null),
  ]);
  return mobileOk({ ...report, details: details?.rows ?? [] });
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function parseDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
