import { getFieldServiceJobDetail } from "@/lib/data/service-field";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  const { id } = await params;
  const detail = await getFieldServiceJobDetail(
    { userId: gate.userId, role: gate.role },
    id,
  );
  if (!detail) return mobileError("errors.notFound", 404);
  return mobileOk(detail);
}
