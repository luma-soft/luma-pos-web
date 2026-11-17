"use client";

import { useEffect } from "react";
import {
  notifyOfflineSyncPreferenceChanged,
  writeStoreOfflinePolicy,
} from "@/lib/offline/offline-sync-preference";
import { clearAllProductCatalogSnapshots } from "@/lib/offline/product-catalog-store";
import { clearAllCachedStockHistory } from "@/lib/offline/product-stock-history-store";

/**
 * Applies the store-wide offline policy (`prefs.app.offlineMode`) before any
 * child reads the offline switch. Wrap children so the (idempotent) storage
 * write happens during this component's render, ahead of the children's
 * snapshots; the change event and cache eviction run from the effect.
 */
export function OfflineStorePolicy({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  writeStoreOfflinePolicy(enabled);

  useEffect(() => {
    notifyOfflineSyncPreferenceChanged();
    if (!enabled) {
      // Store turned offline off: no browser keeps catalog / stock copies.
      void clearAllProductCatalogSnapshots();
      void clearAllCachedStockHistory();
    }
  }, [enabled]);

  return <>{children}</>;
}
