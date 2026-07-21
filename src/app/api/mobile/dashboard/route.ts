import { getDashboard, type DashboardRange } from "@/lib/data/dashboard";
import { getExpiryStockAlerts } from "@/lib/data/inventory-lots";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

const ranges = new Set<DashboardRange>(["today", "7d", "30d", "month"]);

export async function GET(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const requestedRange = searchParam(request, "range", "today");
  const range = ranges.has(requestedRange as DashboardRange)
    ? (requestedRange as DashboardRange)
    : "today";

  const [dashboard, expiry] = await Promise.all([
    getDashboard(range),
    getExpiryStockAlerts(30, 8),
  ]);
  return mobileOk({
    ...dashboard,
    expiryAttentionCount: expiry.attentionCount,
    expiryAlerts: expiry.rows,
  });
}
