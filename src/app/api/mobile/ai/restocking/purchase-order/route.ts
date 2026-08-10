import { createDraftPurchaseForUser } from "@/lib/purchases/draft";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { requireMobileAiStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileAiStockAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured(gate.storeId);
  if (aiBlocked) return aiBlocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(await createDraftPurchaseForUser(gate.userId, body));
}
