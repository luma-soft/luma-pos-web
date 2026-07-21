import { createCashTxForUser } from "@/lib/actions/cashbook";
import { getProfileId } from "@/lib/actions/common";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getCurrentShift } from "@/lib/data/shifts";
import { requireMobileUser } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileError,
  mobileGate,
  readJson,
} from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const profileId = await getProfileId(gate.userId);
  if (!profileId) return mobileError("errors.invalidData");
  const shift = await getCurrentShift(profileId);
  if (!shift) return mobileError("shifts.errors.noOpen", 409);

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileError("errors.invalidData");
  }
  const input = body as Record<string, unknown>;
  const type = input.type === "in" || input.type === "out" ? input.type : null;
  const amount = Number(input.amount);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!type || !Number.isFinite(amount) || amount <= 0 || !note) {
    return mobileError("errors.invalidData");
  }

  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "cash.manage",
    scope: `shift:${shift.id}:cash:${type}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(
    await createCashTxForUser(gate.userId, {
      type,
      fund: "cash",
      amount,
      category: "other",
      note,
    }),
  );
}
