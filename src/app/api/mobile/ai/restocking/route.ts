import { RESTOCK_COVER_DAYS } from "@/lib/ai/restock-policy";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const lookbackDays = Math.min(365, Math.max(7, numberParam(request, "days", 30)));
  return mobileOk({
    rows: await getRestockSuggestions(lookbackDays),
    assumptions: {
      lookbackDays,
      targetCoverDays: RESTOCK_COVER_DAYS,
      includedOrderStatuses: ["completed", "returned"],
      pricingSource: "last_purchase_price_then_cost_price",
      stockSource: "server_total_stock",
    },
    source: {
      target: "inventory",
      label: "Open inventory",
    },
  });
}
