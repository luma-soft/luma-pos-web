"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-browser switch for the web offline layer (POS order outbox, service
 * checklist queue, Product Catalog + stock-history IndexedDB caches).
 *
 * On the store Mac itself (the web opened at a loopback address such as
 * http://127.0.0.1:3000) the database is local, so the offline layer is always
 * off and the switch is not offered. Every other device defaults to on.
 *
 * Off: every write calls the server action / API directly and every read is
 * fetched from the server; nothing new is queued or persisted in IndexedDB.
 * Commands queued earlier while the switch was on are still drained so no
 * accepted sale is lost. On: the existing offline-first path.
 *
 * Store policy: the store-wide `prefs.app.offlineMode` (managed with a manager
 * PIN from the iOS app) is a master switch. When the store turns offline mode
 * off, every browser follows it regardless of its own switch. The last known
 * policy is mirrored in localStorage so an offline reload still honours it.
 */
export const OFFLINE_SYNC_STORAGE_KEY = "luma.web.offline-sync.enabled.v1";
const CHANGE_EVENT = "luma:offline-sync-preference";
export const OFFLINE_STORE_POLICY_STORAGE_KEY = "luma.web.offline-sync.store-policy.v1";
const OFFLINE_SYNC_DEFAULT = true;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True when this page is served by the store Mac to itself (local data). */
export function isLocalHostRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return LOOPBACK_HOSTNAMES.has(window.location?.hostname?.toLowerCase() ?? "");
}

/** Last store-wide policy seen by this browser (`prefs.app.offlineMode`). */
export function isStoreOfflinePolicyEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(OFFLINE_STORE_POLICY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Mirror the store policy into this browser. Returns true when the policy
 * changed from allowed to disallowed (callers then evict local copies).
 * Safe to call during render: it only writes storage; `notify` dispatches the
 * change event and must run from an effect.
 */
export function writeStoreOfflinePolicy(enabled: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    const previous = window.localStorage.getItem(OFFLINE_STORE_POLICY_STORAGE_KEY);
    const next = enabled ? "true" : "false";
    if (previous === next) return false;
    window.localStorage.setItem(OFFLINE_STORE_POLICY_STORAGE_KEY, next);
    return !enabled;
  } catch {
    return false;
  }
}

export function notifyOfflineSyncPreferenceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function isOfflineSyncEnabled(): boolean {
  if (typeof window === "undefined") return OFFLINE_SYNC_DEFAULT;
  if (isLocalHostRuntime()) return false;
  if (!isStoreOfflinePolicyEnabled()) return false;
  try {
    const stored = window.localStorage.getItem(OFFLINE_SYNC_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // Storage can be blocked (private mode, site data disabled).
  }
  return OFFLINE_SYNC_DEFAULT;
}

export function setOfflineSyncEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || isLocalHostRuntime()) return;
  try {
    window.localStorage.setItem(OFFLINE_SYNC_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Keep the in-page event so this tab still follows the user's choice.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled } }));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null
      || event.key === OFFLINE_SYNC_STORAGE_KEY
      || event.key === OFFLINE_STORE_POLICY_STORAGE_KEY
    ) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useOfflineSyncEnabled(): boolean {
  return useSyncExternalStore(subscribe, isOfflineSyncEnabled, () => OFFLINE_SYNC_DEFAULT);
}

export function useStoreOfflinePolicyEnabled(): boolean {
  return useSyncExternalStore(subscribe, isStoreOfflinePolicyEnabled, () => true);
}

function noopSubscribe() {
  return () => {};
}

export function useIsLocalHostRuntime(): boolean {
  return useSyncExternalStore(noopSubscribe, isLocalHostRuntime, () => false);
}
