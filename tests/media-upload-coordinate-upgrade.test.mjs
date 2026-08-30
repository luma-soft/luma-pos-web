import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const database = new PGlite();

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "83000000-0000-4000-8000-000000000001";
const PROJECT_ID = "83000000-0000-4000-8000-000000000002";
const JOB_ID = "83000000-0000-4000-8000-000000000003";
const PRODUCT_MEDIA = "83000000-0000-4000-8000-000000000011";
const PROJECT_MEDIA = "83000000-0000-4000-8000-000000000012";
const SERVICE_MEDIA = "83000000-0000-4000-8000-000000000013";
const UNKNOWN_MEDIA = "83000000-0000-4000-8000-000000000014";
const RUN_ID = "83000000-0000-4000-8000-000000000021";
const ITEM_ID = "83000000-0000-4000-8000-000000000022";

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await database.exec(statement);
  }
}

function legacyMedia(id, domain, status) {
  return `(
    '${id}', '${STORE_ID}', 'supabase', 'private', '${domain}', 'legacy-media',
    'legacy/${id}', '${id}.bin', 'application/pdf', 16, '${status}',
    '2026-08-20T00:00:00.000Z'
  )`;
}

beforeAll(async () => {
  await database.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < "0111_")
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }

  await database.exec(`
    insert into products (id, store_id, sku, name)
    values ('${PRODUCT_ID}', '${STORE_ID}', 'UPGRADE-MEDIA', 'Upgrade media product');

    insert into projects (id, store_id, name, service_type)
    values ('${PROJECT_ID}', '${STORE_ID}', 'Upgrade project', 'camera');

    insert into service_jobs (id, store_id, project_id, code, service_type, title)
    values ('${JOB_ID}', '${STORE_ID}', '${PROJECT_ID}', 'UPGRADE-JOB', 'camera', 'Upgrade job');

    insert into media_objects (
      id, store_id, provider, visibility, domain, bucket, object_key,
      original_file_name, mime_type, size_bytes, status, created_at
    ) values
      ${legacyMedia(PRODUCT_MEDIA, "products", "ready")},
      ${legacyMedia(PROJECT_MEDIA, "projects", "ready")},
      ${legacyMedia(SERVICE_MEDIA, "service-evidence", "pending")},
      ${legacyMedia(UNKNOWN_MEDIA, "unmapped-domain", "ready")};

    insert into product_media (store_id, product_id, media_object_id)
    values ('${STORE_ID}', '${PRODUCT_ID}', '${PRODUCT_MEDIA}');

    insert into service_attachments (
      store_id, project_id, media_object_id, category, bucket, path,
      file_name, mime_type, size_bytes
    ) values (
      '${STORE_ID}', '${PROJECT_ID}', '${PROJECT_MEDIA}', 'document',
      'legacy-media', 'legacy/project.pdf', 'project.pdf', 'application/pdf', 16
    ), (
      '${STORE_ID}', '${PROJECT_ID}', '${SERVICE_MEDIA}', 'before',
      'legacy-media', 'legacy/service.pdf', 'service.pdf', 'application/pdf', 16
    );
    update service_attachments set job_id = '${JOB_ID}'
      where media_object_id = '${SERVICE_MEDIA}';

    insert into media_migration_runs (id, store_id, status)
    values ('${RUN_ID}', '${STORE_ID}', 'running');
    insert into media_migration_items (
      id, store_id, run_id, source_provider, source_bucket, source_key,
      media_object_id, status
    ) values (
      '${ITEM_ID}', '${STORE_ID}', '${RUN_ID}', 'supabase', 'legacy-media',
      'legacy/${UNKNOWN_MEDIA}', '${UNKNOWN_MEDIA}', 'verified'
    );
  `);
});

afterAll(async () => database.close());

describe("0111 media upload coordinate non-empty upgrade", () => {
  test("expand/backfill/contract preserves known targets and quarantines unknown domains", async () => {
    await applySqlFile(`${projectRoot}/drizzle/0111_media_upload_intent_coordinates.sql`);

    const result = await database.query(`
      select id, purpose, target_id, status, upload_expires_at
      from media_objects
      where id in ('${PRODUCT_MEDIA}', '${PROJECT_MEDIA}', '${SERVICE_MEDIA}', '${UNKNOWN_MEDIA}')
      order by id
    `);
    expect(result.rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      targetId: row.target_id,
      status: row.status,
      uploadExpiresAt: row.upload_expires_at?.toISOString(),
    }))).toEqual([
      {
        id: PRODUCT_MEDIA,
        purpose: "product-image",
        targetId: PRODUCT_ID,
        status: "ready",
        uploadExpiresAt: "2026-08-20T00:10:00.000Z",
      },
      {
        id: PROJECT_MEDIA,
        purpose: "project-document",
        targetId: PROJECT_ID,
        status: "ready",
        uploadExpiresAt: "2026-08-20T00:10:00.000Z",
      },
      {
        id: SERVICE_MEDIA,
        purpose: "service-evidence",
        targetId: JOB_ID,
        status: "pending",
        uploadExpiresAt: "2026-08-20T00:10:00.000Z",
      },
      {
        id: UNKNOWN_MEDIA,
        purpose: "project-document",
        targetId: STORE_ID,
        status: "quarantined",
        uploadExpiresAt: "2026-08-20T00:10:00.000Z",
      },
    ]);

    const columns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_name = 'media_objects'
        and column_name in ('purpose', 'target_id', 'upload_expires_at')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "purpose", is_nullable: "NO" },
      { column_name: "target_id", is_nullable: "NO" },
      { column_name: "upload_expires_at", is_nullable: "NO" },
    ]);

    const item = await database.query(`
      select media_object_id, status from media_migration_items where id = '${ITEM_ID}'
    `);
    expect(item.rows).toEqual([{ media_object_id: UNKNOWN_MEDIA, status: "verified" }]);
  });
});
