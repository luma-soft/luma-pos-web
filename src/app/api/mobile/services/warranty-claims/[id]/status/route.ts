import { transitionWarrantyClaim } from "@/lib/actions/services";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  const { id } = await params;
  return mobileAction(await transitionWarrantyClaim({
    ...(body as Record<string, unknown>),
    claimId: id,
  } as Parameters<typeof transitionWarrantyClaim>[0]));
}
