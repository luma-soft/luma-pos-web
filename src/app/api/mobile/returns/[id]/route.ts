import { getReturn } from "@/lib/data/returns";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const detail = await getReturn(gate.storeId, id);
  return detail ? mobileOk(detail) : mobileError("errors.notFound", 404);
}
