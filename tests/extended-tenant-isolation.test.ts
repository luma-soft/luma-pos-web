import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createShopeeCallbackState,
  peekShopeeCallbackStoreId,
  readShopeeCallbackState,
} from "@/lib/shopee/callback-state";

const STORE_A = "00000000-0000-4000-8000-000000000001";

describe("extended tenant isolation", () => {
  test("Shopee callback state is signed, store-bound, and expires", () => {
    const now = Date.UTC(2026, 7, 10, 0, 0, 0);
    const state = createShopeeCallbackState(STORE_A, "partner-secret", now);

    expect(peekShopeeCallbackStoreId(state)).toBe(STORE_A);
    expect(readShopeeCallbackState(state, "partner-secret", now + 60_000)).toEqual({ storeId: STORE_A });
    expect(readShopeeCallbackState(state, "wrong-secret", now + 60_000)).toBeNull();
    const [payload, signature] = state.split(".");
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}.${signature}`;
    expect(readShopeeCallbackState(tampered, "partner-secret", now)).toBeNull();
    expect(readShopeeCallbackState(state, "partner-secret", now + 16 * 60_000)).toBeNull();
  });

  test("migration backfills all extended domains and scopes business uniqueness", () => {
    const migration = readFileSync(
      new URL("../drizzle/0103_extended_tenant_isolation.sql", import.meta.url),
      "utf8",
    );

    for (const table of [
      "projects", "service_jobs", "notification_events", "payment_webhook_events",
      "marketplace_shops", "einvoices", "ai_usage_counters", "zalo_message_events",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("ALTER COLUMN store_id SET NOT NULL");
    expect(migration).toContain("service_jobs_store_code_unique");
    expect(migration).toContain("notification_events_store_event_key_unique");
    expect(migration).toContain("marketplace_sync_jobs_store_idempotency_idx");
    expect(migration).toContain("PRIMARY KEY (\"store_id\", \"period\")");
  });
});
