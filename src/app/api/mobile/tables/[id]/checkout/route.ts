import { checkoutTableForUser } from "@/lib/actions/tables";
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
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const payload = body as { method?: unknown; lineIds?: unknown };
  const method = payload.method === "credit"
    ? "credit"
    : payload.method === "bank_transfer"
      ? "bank_transfer"
      : "cash";

  return mobileAction(
    await checkoutTableForUser(gate.userId, id, method, payload.lineIds),
  );
}
