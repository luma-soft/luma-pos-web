import { getCustomerPartnerDetail } from "@/lib/data/partners";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const customer = await getCustomerPartnerDetail(id);
  if (!customer) return mobileError("errors.notFound", 404);
  return mobileOk(customer);
}
