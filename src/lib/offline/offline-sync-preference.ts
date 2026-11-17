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
 */
export const OFFLINE_SYNC_STORAGE_KEY = "luma.web.offline-sync.enabled.v1";
const CHANGE_EVENT = "luma:offline-sync-preference";
const OFFLINE_SYNC_DEFAULT = true;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True when this page is served by the store Mac to itself (local data). */
export function isLocalHostRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return LOOPBACK_HOSTNAMES.has(window.location?.hostname?.toLowerCase() ?? "");
}

export function isOfflineSyncEnabled(): boolean {
  if (typeof window === "undefined") return OFFLINE_SYNC_DEFAULT;
  if (isLocalHostRuntime()) return false;
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
    if (event.key === null || event.key === OFFLINE_SYNC_STORAGE_KEY) onChange();
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

function noopSubscribe() {
  return () => {};
}

export function useIsLocalHostRuntime(): boolean {
  return useSyncExternalStore(noopSubscribe, isLocalHostRuntime, () => false);
}
