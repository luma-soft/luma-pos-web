import { mergeOrders } from "@/lib/actions/order-edit";
import { cancelOrders } from "@/lib/actions/orders";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  return mobileOk({ canManage: gate.role === "owner" || gate.role === "manager" });
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  if (!body || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 20 ||
      !body.ids.every(isMobileEntityId) || new Set(body.ids).size !== body.ids.length) {
    return mobileError("errors.invalidData");
  }
  if (body.action === "merge") {
    if (body.ids.length < 2) return mobileError("merge.errors.needTwo");
    return mobileAction(await mergeOrders(body.ids));
  }
  if (body.action === "cancel") return mobileAction(await cancelOrders(body.ids));
  return mobileError("errors.invalidData");
}
