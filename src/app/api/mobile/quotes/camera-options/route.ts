import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileGate } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  return Response.json({ ok: true, data: await getCameraQuoteFormOptions() });
}
