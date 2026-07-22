import { reserveServiceJobMaterial } from "@/lib/actions/services";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await reserveServiceJobMaterial(body as Parameters<typeof reserveServiceJobMaterial>[0]));
}
