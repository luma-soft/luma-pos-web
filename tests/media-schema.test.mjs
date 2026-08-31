import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { mediaObjects } from "@/db/schema";

const queryDb = drizzle.mock({ schema: { mediaObjects } });
mock.module("@/db", () => ({ db: queryDb }));

const sql = readFileSync("drizzle/0110_unified_media_storage.sql", "utf8");

test("media tables are tenant-owned and protected by SELECT-only RLS", () => {
  const tenantTables = [
    "media_objects",
    "product_media",
    "service_handover_document_media",
    "media_migration_runs",
    "media_migration_items",
  ];

  expect(sql).toContain('CREATE TABLE "media_objects"');
  expect(sql).toContain('"store_id" uuid NOT NULL');
  expect(sql).toContain("store_id = public.current_active_store_id()");
  expect(sql).not.toMatch(/FOR (?:UPDATE|INSERT|DELETE) TO authenticated/i);
  expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE");
  expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE[^;]+FROM authenticated/);

  for (const table of tenantTables) {
    expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    expect(sql).toMatch(
      new RegExp(
        `CREATE POLICY "[^"]+" ON "${table}" FOR SELECT TO authenticated\\nUSING \\(store_id = public\\.current_active_store_id\\(\\)\\)`,
      ),
    );
  }
});

test("canonical media constraints and indexes preserve lifecycle invariants", () => {
  expect(sql).toContain("CONSTRAINT \"media_objects_provider_check\" CHECK (\"provider\" IN ('r2','supabase'))");
  expect(sql).toContain("CONSTRAINT \"media_objects_visibility_check\" CHECK (\"visibility\" IN ('public','private'))");
  expect(sql).toContain("CONSTRAINT \"media_objects_status_check\" CHECK (\"status\" IN ('pending','ready','quarantined','deleted'))");
  expect(sql).toContain('CONSTRAINT "media_objects_location_unique" UNIQUE ("provider","bucket","object_key")');
  expect(sql).toContain('CREATE UNIQUE INDEX "product_media_active_primary_unique"');
  expect(sql).toContain('WHERE "is_primary" = true AND "deleted_at" IS NULL');
  expect(sql).toContain('UNIQUE ("run_id","source_provider","source_bucket","source_key")');
  expect(sql).not.toContain('ADD CONSTRAINT "products_store_id_id_unique"');
  expect(sql).not.toContain('ADD CONSTRAINT "service_handover_documents_store_id_id_unique"');
});

test("domain references cannot cascade-delete canonical media", () => {
  expect(sql).toContain('ADD COLUMN "logo_media_object_id" uuid');
  expect(sql).toContain('ADD COLUMN "media_object_id" uuid');
  expect(sql).not.toMatch(/REFERENCES "media_objects"\("id"\) ON DELETE CASCADE/);
  expect(sql).toContain('REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION');
  expect(sql).not.toContain('REFERENCES "media_objects"("store_id","id") ON DELETE RESTRICT');
});

test("service attachments retain compatibility coordinates", () => {
  expect(sql).toContain('ADD COLUMN "media_object_id" uuid');
  expect(sql).toContain('ADD COLUMN "project_phase" text');
  expect(sql).toContain("'survey','construction','after_installation','acceptance','handover','other'");
  expect(sql).not.toContain('DROP COLUMN "bucket"');
  expect(sql).not.toContain('DROP COLUMN "path"');
});

test("repository scopes reads and one-way state transitions to the store", () => {
  const repository = readFileSync("src/lib/media/repository.ts", "utf8");
  const core = readFileSync("src/lib/media/repository-core.ts", "utf8");

  expect(repository).toContain(
    "eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId))",
  );
  expect(repository).toContain('eq(mediaObjects.status, "pending")');
  expect(repository).toContain('status: "ready"');
  expect(core).toContain('eq(mediaObjects.status, "ready")');
  expect(core).toContain('status: "deleted"');
  expect(core).toContain('.for("update")');
  expect(core).toContain('outcome: "referenced"');
  expect(repository).not.toContain("db.delete(mediaObjects)");
  expect(core).not.toContain(".delete(mediaObjects)");
});

test("repository update SQL scopes ready transitions by media and store", async () => {
  const { buildMarkMediaReadyQuery } = await import("../src/lib/media/repository");
  const input = {
    storeId: "11111111-1111-4111-8111-111111111111",
    mediaId: "22222222-2222-4222-8222-222222222222",
  };

  const ready = buildMarkMediaReadyQuery(queryDb, {
    ...input,
    actualSizeBytes: 2048,
    readyAt: new Date("2026-08-30T00:00:00.000Z"),
  }).toSQL();
  expect(ready.sql).toContain('where ("media_objects"."id" = $');
  expect(ready.sql).toContain('and "media_objects"."store_id" = $');
  expect(ready.sql).toContain('and "media_objects"."status" = $');
  expect(ready.params).toContain(input.mediaId);
  expect(ready.params).toContain(input.storeId);
  expect(ready.params).toContain("pending");
  expect(ready.params).toContain("ready");

});

test("repository insert starts pending and reads by media plus store", async () => {
  const {
    buildCreatePendingMediaQuery,
    buildGetMediaForStoreQuery,
  } = await import("../src/lib/media/repository");
  const storeId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const mediaId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  const targetId = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";
  const canonicalStoreId = storeId.toLowerCase();
  const canonicalMediaId = mediaId.toLowerCase();
  const canonicalTargetId = targetId.toLowerCase();

  const pending = buildCreatePendingMediaQuery(queryDb, {
    id: mediaId,
    storeId,
    provider: "r2",
    visibility: "private",
    purpose: "project-document",
    targetId,
    domain: "projects",
    bucket: "private-media",
    objectKey: `stores/${storeId}/projects/2026/08/${mediaId}/original.pdf`,
    originalFileName: "handover.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4096,
    uploadExpiresAt: new Date("2026-08-30T00:10:00.000Z"),
  }).toSQL();
  expect(pending.params).toContain(canonicalStoreId);
  expect(pending.params).toContain(canonicalMediaId);
  expect(pending.params).toContain(canonicalTargetId);
  expect(pending.params).toContain("pending");

  const read = buildGetMediaForStoreQuery(queryDb, { storeId, mediaId }).toSQL();
  expect(read.sql).toContain('where ("media_objects"."id" = $');
  expect(read.sql).toContain('and "media_objects"."store_id" = $');
  expect(read.params).toContain(canonicalMediaId);
  expect(read.params).toContain(canonicalStoreId);
});
