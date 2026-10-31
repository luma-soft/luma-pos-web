import { getProductCatalogRevision, getProductCatalogSnapshot } from "@/lib/data/product-catalog";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

// One authoritative, actor-scoped product projection for mobile POS and
// inventory. The existing /products and /pos routes remain available during
// migration; consumers must not merge partial/delta snapshots as full lists.
//
// Delta is intentionally NOT advertised until the backend persists product
// tombstones, stock/price changes and revision-stamped mutation history.
export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const params = new URL(request.url).searchParams;
  const sinceRevision = params.get("sinceRevision")?.trim() ?? null;
  if (sinceRevision && !/^\d+$/.test(sinceRevision)) {
    return mobileError("errors.invalidData", 400);
  }

  // Fast path: no need to build or transfer a full catalog when unchanged.
  // Use the canonical revision shared with the catalog_sync_state trigger.
  const revision = await getProductCatalogRevision(gate.storeId);
  if (sinceRevision === revision) {
    const response = mobileOk({
      mode: "unchanged" as const,
      revision,
      // Never claim delta while no revision-scoped tombstone log exists.
      deltaSupported: false,
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }

  try {
    const snapshot = await getProductCatalogSnapshot(
      gate.storeId,
      gate.userId,
      gate.role,
      { includeInactive: true },
    );
    const response = mobileOk({
      mode: "full" as const,
      revision: snapshot.revision,
      deltaSupported: false,
      catalog: snapshot,
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch {
    // Do not send a partial catalog that a client might persist as complete.
    return mobileError("errors.serverError", 503);
  }
}
