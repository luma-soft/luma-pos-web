import { openShiftForUser } from "@/lib/actions/shifts";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  const openingFloat =
    body && typeof body === "object"
      ? Number(
          (body as { openingFloat?: unknown; openingCash?: unknown })
            .openingFloat ??
            (body as { openingCash?: unknown }).openingCash ??
            0
        )
      : 0;

  return mobileAction(await openShiftForUser(gate.userId, openingFloat));
}
