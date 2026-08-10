import { readdirSync } from "node:fs";
import postgres from "postgres";
import { CURRENT_STORE_ID, CURRENT_STORE_SLUG } from "@/lib/tenancy/constants";
import { STORE_FEATURE_KEYS } from "@/lib/tenancy/store-features";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");

const sql = postgres(databaseUrl, { max: 1, prepare: false });

function assertAudit(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`TENANT_FOUNDATION_AUDIT_FAILED: ${message}`);
}

try {
  const [store] = await sql<[{ id: string; slug: string; status: string }]>`
    select id::text, slug, status::text
    from stores
    where id = ${CURRENT_STORE_ID}::uuid
  `;
  assertAudit(Boolean(store), "current store is missing");
  assertAudit(store.slug === CURRENT_STORE_SLUG, "current store slug mismatch");
  assertAudit(store.status === "active", "current store is not active");

  const [counts] = await sql<[{ profiles: number; settings: number; catalog: number }]>`
    select
      (select count(*)::int from profiles where store_id = ${CURRENT_STORE_ID}::uuid) as profiles,
      (select count(*)::int from store_settings where store_id = ${CURRENT_STORE_ID}::uuid) as settings,
      (select count(*)::int from catalog_sync_state where store_id = ${CURRENT_STORE_ID}::uuid) as catalog
  `;
  const [nulls] = await sql<[{ profiles: number; settings: number; catalog: number }]>`
    select
      (select count(*)::int from profiles where store_id is null) as profiles,
      (select count(*)::int from store_settings where store_id is null) as settings,
      (select count(*)::int from catalog_sync_state where store_id is null) as catalog
  `;
  assertAudit(counts.settings === 1, "current store must have exactly one settings row");
  assertAudit(counts.catalog === 1, "current store must have exactly one catalog revision row");
  assertAudit(Object.values(nulls).every((count) => count === 0), "foundation contains null store IDs");

  const features = await sql<{ feature_key: string; enabled: boolean }[]>`
    select feature_key, enabled
    from store_features
    where store_id = ${CURRENT_STORE_ID}::uuid
  `;
  const enabled = new Map(features.map((row) => [row.feature_key, row.enabled]));
  assertAudit(
    STORE_FEATURE_KEYS.every((key) => enabled.get(key) === true),
    "current store does not retain every registered feature",
  );

  const migrationFiles = readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const appliedMigrations = await sql<{ name: string }[]>`
    select name from _migrations
  `;
  const appliedMigrationNames = new Set(appliedMigrations.map((row) => row.name));
  const pendingMigrations = migrationFiles.filter((name) => !appliedMigrationNames.has(name));
  assertAudit(
    appliedMigrationNames.has("0099_multi_tenant_foundation.sql"),
    "foundation migration is not tracked as applied",
  );
  assertAudit(
    pendingMigrations.length === 0,
    `pending migrations: ${pendingMigrations.join(", ")}`,
  );

  console.log(JSON.stringify({
    currentStore: store,
    counts,
    nullStoreIds: nulls,
    registeredFeatures: STORE_FEATURE_KEYS.length,
    migrationApplied: true,
    pendingMigrations,
  }, null, 2));
} finally {
  await sql.end();
}
