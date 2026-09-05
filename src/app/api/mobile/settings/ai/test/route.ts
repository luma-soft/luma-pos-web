import { testAiProvider } from "@/lib/actions/settings";
import { requireMobileOwner } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileOwner();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  if (!body || (body.kind !== "text" && body.kind !== "vision")) {
    return mobileError("errors.invalidData");
  }
  return mobileAction(await testAiProvider(body, body.kind));
}
