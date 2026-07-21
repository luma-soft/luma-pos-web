import { closeShiftForUser } from "@/lib/actions/shifts";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  const countedCash =
    body && typeof body === "object"
      ? Number((body as { countedCash?: unknown }).countedCash ?? 0)
      : 0;
  const note =
    body && typeof body === "object"
      ? String((body as { note?: unknown }).note ?? "")
      : undefined;

  return mobileAction(await closeShiftForUser(gate.userId, countedCash, note));
}
