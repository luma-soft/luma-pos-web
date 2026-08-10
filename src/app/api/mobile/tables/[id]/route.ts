import { getTable } from "@/lib/data/tables";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const table = await getTable(gate.storeId, id);
  if (!table) return mobileError("errors.notFound", 404);
  return mobileOk(table);
}
