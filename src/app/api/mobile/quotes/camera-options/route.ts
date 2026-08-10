import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { requireMobileFeatureRole } from "@/lib/mobile/auth";
import { mobileGate } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileFeatureRole("camera_quote_builder", ["owner", "manager", "warehouse"]);
  if (!gate.ok) return mobileGate(gate)!;
  return Response.json({ ok: true, data: await getCameraQuoteFormOptions(gate.storeId, true) });
}
