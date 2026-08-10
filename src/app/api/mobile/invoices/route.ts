import { getOrders } from "@/lib/data/orders";
import type { OrderPaymentFilter, OrderStatusFilter } from "@/lib/data/orders";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  return mobileOk(
    await getOrders(gate.storeId, {
      q: searchParam(request, "q"),
      status: searchParam(request, "status") as OrderStatusFilter | undefined,
      payment: searchParam(request, "payment") as
        | OrderPaymentFilter
        | undefined,
      from: searchParam(request, "from"),
      to: searchParam(request, "to"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 20),
    })
  );
}
