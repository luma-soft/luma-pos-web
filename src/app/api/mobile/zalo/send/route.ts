import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";
import { sendZaloMessage } from "@/lib/zalo/send";

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const value = body as Record<string, unknown>;
  if (value.kind !== "invoice" || typeof value.orderId !== "string") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  return mobileAction(
    await sendZaloMessage({
      kind: "invoice",
      orderId: value.orderId,
      url: typeof value.url === "string" ? value.url : undefined,
      actorId: gate.userId,
    })
  );
}
