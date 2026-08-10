import { getOrder, getOrders } from "@/lib/data/orders";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const list = await getOrders(gate.storeId, {
    q: searchParam(request, "q"),
    status: "completed",
    page: 1,
    pageSize: 10,
  });
  const details = await Promise.all(list.rows.map((row) => getOrder(gate.storeId, row.id)));

  return mobileOk({
    ...list,
    rows: details.filter(Boolean),
  });
}
