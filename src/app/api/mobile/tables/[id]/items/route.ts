import { setTableCartForUser } from "@/lib/actions/tables";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const body = await readJson(request);
  const items =
    body && typeof body === "object" && "items" in body
      ? (body as { items?: unknown }).items
      : body;

  return mobileAction(await setTableCartForUser(id, items));
}
