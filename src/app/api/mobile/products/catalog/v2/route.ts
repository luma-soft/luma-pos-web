import {
  getProductCatalogDeltaV2,
  getProductCatalogRevision,
  getProductCatalogSnapshot,
} from "@/lib/data/product-catalog";
import { productCatalogScopeId } from "@/lib/product-catalog";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const params = new URL(request.url).searchParams;
  const sinceRevision = params.get("sinceRevision")?.trim() ?? null;
  const sinceScope = params.get("sinceScope")?.trim() ?? null;
  const currentScope = productCatalogScopeId(gate.storeId, gate.userId, gate.role);
  const sameScope = sinceScope === currentScope;
  if (sinceRevision && !/^\d+$/.test(sinceRevision)) {
    return mobileError("errors.invalidData", 400);
  }

  try {
    const revision = await getProductCatalogRevision(gate.storeId);
    if (sameScope && sinceRevision === revision) {
      const response = mobileOk({
        protocolVersion: 2 as const,
        mode: "unchanged" as const,
        revision,
        deltaSupported: true,
      });
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      return response;
    }

    if (sameScope && sinceRevision && sinceRevision !== revision) {
      let delta: Awaited<ReturnType<typeof getProductCatalogDeltaV2>> = null;
      try {
        delta = await getProductCatalogDeltaV2(
          gate.storeId,
          gate.userId,
          gate.role,
          sinceRevision,
          revision,
        );
      } catch {
        // Journal expiration/query failure must recover with a complete
        // snapshot. If that also fails, the outer handler returns 503.
      }
      if (delta) {
        const response = mobileOk({
          protocolVersion: 2 as const,
          mode: "delta" as const,
          revision: delta.revision,
          deltaSupported: true,
          delta,
        });
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
        return response;
      }
    }

    const catalog = await getProductCatalogSnapshot(
      gate.storeId,
      gate.userId,
      gate.role,
      { includeInactive: true },
    );
    const response = mobileOk({
      protocolVersion: 2 as const,
      mode: "full" as const,
      revision: catalog.revision,
      deltaSupported: true,
      catalog,
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch {
    return mobileError("errors.serverError", 503);
  }
}
