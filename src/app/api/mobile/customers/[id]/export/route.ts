import { getCustomerPrivacyExport } from "@/lib/customers/privacy";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { id } = await params;
  const data = await getCustomerPrivacyExport(id);
  return data ? mobileOk(data) : mobileError("errors.notFound", 404);
}
