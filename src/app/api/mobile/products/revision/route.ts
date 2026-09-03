import { getProductCatalogRevision } from "@/lib/data/product-catalog";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const revision = await getProductCatalogRevision(gate.storeId);
  const response = mobileOk({ revision });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
