import { saveServiceJobMaterial } from "@/lib/actions/services";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await saveServiceJobMaterial(body as Parameters<typeof saveServiceJobMaterial>[0]));
}
