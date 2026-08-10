import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0106_tenant_rls_and_explicit_store_ids.sql", "utf8");
const provision = readFileSync("src/scripts/provision-store.ts", "utf8");

describe("tenant rollout hardening", () => {
  test("database tenant keys have no implicit current-store fallback", () => {
    expect(schema).not.toContain("default(CURRENT_STORE_ID)");
    expect(schema).toContain("STORE_ID_REQUIRED");
    expect(migration).toContain("ALTER COLUMN store_id DROP DEFAULT");
    expect(migration).toContain("ALTER COLUMN store_id SET NOT NULL");
  });

  test("broad direct-client reads are replaced by active membership", () => {
    expect(migration).toContain("current_active_store_id");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/USING\s*\(true\)/i);
  });

  test("operations provisioning is idempotent and seeds no optional features", () => {
    expect(provision).toContain("on conflict (slug) do update");
    expect(provision).toContain("on conflict (store_id, feature_key) do nothing");
    expect(provision).toContain("${featureKey}, false");
    expect(provision).toContain("Direct-client tenant isolation failed");
  });
});
