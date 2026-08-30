import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { applyMigrationFileAtomically } = await import(
  `${projectRoot}/src/db/migration-runner.ts`
);
const database = new PGlite();
const migrationConnection = {
  async unsafe(statement, parameters = []) {
    if (parameters.length) return (await database.query(statement, parameters)).rows;
    return database.exec(statement);
  },
};

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "83000000-0000-4000-8000-000000000001";
const PROJECT_ID = "83000000-0000-4000-8000-000000000002";
const JOB_ID = "83000000-0000-4000-8000-000000000003";
const DOCUMENT_ID = "83000000-0000-4000-8000-000000000004";
const REQUEST_PROJECT_ID = "83000000-0000-4000-8000-000000000005";
const REQUEST_JOB_ID = "83000000-0000-4000-8000-000000000006";
const SESSION_ID = "83000000-0000-4000-8000-000000000007";
const BRAND_ID = "83000000-0000-4000-8000-000000000008";
const PRODUCT_MEDIA = "83000000-0000-4000-8000-000000000011";
const PROJECT_MEDIA = "83000000-0000-4000-8000-000000000012";
const SERVICE_MEDIA = "83000000-0000-4000-8000-000000000013";
const UNKNOWN_MEDIA = "83000000-0000-4000-8000-000000000014";
const BRAND_MEDIA = "83000000-0000-4000-8000-000000000015";
const HANDOVER_MEDIA = "83000000-0000-4000-8000-000000000016";
const CUSTOMER_PROJECT_MEDIA = "83000000-0000-4000-8000-000000000017";
const CUSTOMER_JOB_MEDIA = "83000000-0000-4000-8000-000000000018";
const SIGNATURE_MEDIA = "83000000-0000-4000-8000-000000000019";
const AI_MEDIA = "83000000-0000-4000-8000-000000000020";
const CONFLICT_MEDIA = "83000000-0000-4000-8000-000000000023";
const MALFORMED_AI_MEDIA = [
  "83000000-0000-4000-8000-000000000024",
  "83000000-0000-4000-8000-000000000025",
  "83000000-0000-4000-8000-000000000026",
  "83000000-0000-4000-8000-000000000027",
];
const RUN_ID = "83000000-0000-4000-8000-000000000021";
const ITEM_ID = "83000000-0000-4000-8000-000000000022";
const ROLLED_RUN_ID = "83000000-0000-4000-8000-000000000031";
const ROLLED_ITEM_ID = "83000000-0000-4000-8000-000000000032";
const NULL_ITEM_ID = "83000000-0000-4000-8000-000000000033";

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
  await database.exec(`
    create role anon;
    create role authenticated;
    create table _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
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

    insert into service_handover_documents (id, store_id, project_id, job_id, type, title)
    values ('${DOCUMENT_ID}', '${STORE_ID}', '${PROJECT_ID}', '${JOB_ID}', 'handover', 'Upgrade handover');
    insert into service_customer_requests (
      id, store_id, code, project_id, title, contact_name, token_hash, token_expires_at, linked_job_id
    ) values
      ('${REQUEST_PROJECT_ID}', '${STORE_ID}', 'UPGRADE-REQUEST-PROJECT', '${PROJECT_ID}',
       'Project request', 'Customer', repeat('a', 64), now() + interval '1 day', null),
      ('${REQUEST_JOB_ID}', '${STORE_ID}', 'UPGRADE-REQUEST-JOB', '${PROJECT_ID}',
       'Job request', 'Customer', repeat('b', 64), now() + interval '1 day', '${JOB_ID}');
    insert into ai_chat_sessions (id, store_id, title)
    values ('${SESSION_ID}', '${STORE_ID}', 'Upgrade AI');
    insert into brands (id, store_id, name)
    values ('${BRAND_ID}', '${STORE_ID}', 'Upgrade brand');

    insert into media_objects (
      id, store_id, provider, visibility, domain, bucket, object_key,
      original_file_name, mime_type, size_bytes, status, created_at
    ) values
      ${legacyMedia(PRODUCT_MEDIA, "products", "ready")},
      ${legacyMedia(PROJECT_MEDIA, "projects", "ready")},
      ${legacyMedia(SERVICE_MEDIA, "service-evidence", "pending")},
      ${legacyMedia(UNKNOWN_MEDIA, "unmapped-domain", "ready")},
      ${legacyMedia(BRAND_MEDIA, "products", "ready")},
      ${legacyMedia(HANDOVER_MEDIA, "projects", "ready")},
      ${legacyMedia(CUSTOMER_PROJECT_MEDIA, "projects", "ready")},
      ${legacyMedia(CUSTOMER_JOB_MEDIA, "service-evidence", "ready")},
      ${legacyMedia(SIGNATURE_MEDIA, "service-evidence", "ready")},
      ${legacyMedia(AI_MEDIA, "ai", "ready")},
      ${legacyMedia(CONFLICT_MEDIA, "products", "ready")},
      ${MALFORMED_AI_MEDIA.map((id) => legacyMedia(id, "ai", "ready")).join(",")};

    insert into product_media (store_id, product_id, media_object_id)
    values
      ('${STORE_ID}', '${PRODUCT_ID}', '${PRODUCT_MEDIA}'),
      ('${STORE_ID}', '${PRODUCT_ID}', '${CONFLICT_MEDIA}');
    update brands set logo_media_object_id = '${BRAND_MEDIA}' where id = '${BRAND_ID}';

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

    insert into service_handover_document_media (store_id, document_id, media_object_id)
    values
      ('${STORE_ID}', '${DOCUMENT_ID}', '${HANDOVER_MEDIA}'),
      ('${STORE_ID}', '${DOCUMENT_ID}', '${CONFLICT_MEDIA}');
    insert into service_customer_request_attachments (
      store_id, request_id, media_object_id, bucket, path, file_name, mime_type, size_bytes, sha256
    ) values
      ('${STORE_ID}', '${REQUEST_PROJECT_ID}', '${CUSTOMER_PROJECT_MEDIA}', 'legacy-media',
       'legacy/customer-project.png', 'customer-project.png', 'image/png', 16, repeat('c', 64)),
      ('${STORE_ID}', '${REQUEST_JOB_ID}', '${CUSTOMER_JOB_MEDIA}', 'legacy-media',
       'legacy/customer-job.png', 'customer-job.png', 'image/png', 16, repeat('d', 64));

    insert into service_attachments (
      id, store_id, project_id, job_id, media_object_id, category, bucket,
      path, file_name, mime_type, size_bytes
    ) values (
      '83000000-0000-4000-8000-000000000041', '${STORE_ID}', '${PROJECT_ID}', '${JOB_ID}',
      '${SIGNATURE_MEDIA}', 'signature', 'legacy-media', 'legacy/signature.pdf',
      'signature.pdf', 'application/pdf', 16
    );
    insert into service_signatures (
      store_id, project_id, job_id, attachment_id, signer_name, document_hash
    ) values (
      '${STORE_ID}', '${PROJECT_ID}', '${JOB_ID}',
      '83000000-0000-4000-8000-000000000041', 'Customer', repeat('e', 64)
    );
    update service_attachments set deleted_at = now()
      where id = '83000000-0000-4000-8000-000000000041';
    update service_signatures set invalidated_at = null, invalidation_reason = null
      where attachment_id = '83000000-0000-4000-8000-000000000041';

    insert into ai_chat_messages (store_id, session_id, role, content, attachments)
    values
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'valid',
       jsonb_build_array(jsonb_build_object('mediaId', '${AI_MEDIA}'))),
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'null', null),
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'object', '{"mediaId":"${MALFORMED_AI_MEDIA[0]}"}'::jsonb),
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'scalar', '42'::jsonb),
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'bad elements',
       jsonb_build_array(null, 9, jsonb_build_object('mediaId', 'not-a-uuid'),
                         jsonb_build_object('mediaId', '83000000-0000-4000-8000-000000000099', 'ignored', true))),
      ('${STORE_ID}', '${SESSION_ID}', 'user', 'missing media id',
       jsonb_build_array(jsonb_build_object('name', '${MALFORMED_AI_MEDIA[2]}')));

    insert into media_migration_runs (id, store_id, status)
    values
      ('${RUN_ID}', '${STORE_ID}', 'running'),
      ('${ROLLED_RUN_ID}', '${STORE_ID}', 'rolled_back');
    insert into media_migration_items (
      id, store_id, run_id, source_provider, source_bucket, source_key,
      media_object_id, status
    ) values
      ('${ITEM_ID}', '${STORE_ID}', '${RUN_ID}', 'supabase', 'legacy-media',
       'legacy/${UNKNOWN_MEDIA}', '${UNKNOWN_MEDIA}', 'verified'),
      ('${ROLLED_ITEM_ID}', '${STORE_ID}', '${ROLLED_RUN_ID}', 'supabase', 'legacy-media',
       'legacy/${MALFORMED_AI_MEDIA[3]}', '${MALFORMED_AI_MEDIA[3]}', 'rolled_back'),
      ('${NULL_ITEM_ID}', '${STORE_ID}', '${RUN_ID}', 'supabase', 'legacy-media',
       'legacy/null', null, 'pending');
  `);
});

afterAll(async () => database.close());

describe("0111 media upload coordinate non-empty upgrade", () => {
  test("backfills every trusted reference surface and quarantines malformed or conflicting coordinates", async () => {
    const migrationName = "0111_media_upload_intent_coordinates.sql";
    const migrationSql = readFileSync(`${projectRoot}/drizzle/${migrationName}`, "utf8");
    const failedSql = migrationSql.replace(
      "--> statement-breakpoint",
      "--> statement-breakpoint\nselect forced_0111_failure();\n--> statement-breakpoint",
    );
    await expect(applyMigrationFileAtomically(
      migrationConnection,
      migrationName,
      failedSql,
    )).rejects.toThrow();
    expect((await database.query(`
      select column_name from information_schema.columns
      where table_name = 'media_objects'
        and column_name in ('purpose', 'target_id', 'upload_expires_at')
    `)).rows).toEqual([]);
    expect((await database.query(
      `select name from _migrations where name = '${migrationName}'`,
    )).rows).toEqual([]);

    await applyMigrationFileAtomically(migrationConnection, migrationName, migrationSql);

    const result = await database.query(`
      select id, purpose, target_id, status, upload_expires_at
      from media_objects
      where id in (
        '${PRODUCT_MEDIA}', '${PROJECT_MEDIA}', '${SERVICE_MEDIA}', '${UNKNOWN_MEDIA}',
        '${BRAND_MEDIA}', '${HANDOVER_MEDIA}', '${CUSTOMER_PROJECT_MEDIA}',
        '${CUSTOMER_JOB_MEDIA}', '${SIGNATURE_MEDIA}', '${AI_MEDIA}', '${CONFLICT_MEDIA}',
        ${MALFORMED_AI_MEDIA.map((id) => `'${id}'`).join(",")}
      )
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
      { id: BRAND_MEDIA, purpose: "product-image", targetId: STORE_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: HANDOVER_MEDIA, purpose: "project-document", targetId: PROJECT_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: CUSTOMER_PROJECT_MEDIA, purpose: "project-document", targetId: PROJECT_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: CUSTOMER_JOB_MEDIA, purpose: "service-evidence", targetId: JOB_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: SIGNATURE_MEDIA, purpose: "service-evidence", targetId: JOB_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: AI_MEDIA, purpose: "ai-attachment", targetId: SESSION_ID, status: "ready", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      { id: CONFLICT_MEDIA, purpose: "product-image", targetId: STORE_ID, status: "quarantined", uploadExpiresAt: "2026-08-20T00:10:00.000Z" },
      ...MALFORMED_AI_MEDIA.map((id) => ({
        id,
        purpose: "ai-attachment",
        targetId: STORE_ID,
        status: "quarantined",
        uploadExpiresAt: "2026-08-20T00:10:00.000Z",
      })),
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
    expect((await database.query(
      `select name from _migrations where name = '${migrationName}'`,
    )).rows).toEqual([{ name: migrationName }]);

    const items = await database.query(`
      select id, media_object_id, status from media_migration_items
      where id in ('${ITEM_ID}', '${ROLLED_ITEM_ID}', '${NULL_ITEM_ID}') order by id
    `);
    expect(items.rows).toEqual([
      { id: ITEM_ID, media_object_id: UNKNOWN_MEDIA, status: "verified" },
      { id: ROLLED_ITEM_ID, media_object_id: MALFORMED_AI_MEDIA[3], status: "rolled_back" },
      { id: NULL_ITEM_ID, media_object_id: null, status: "pending" },
    ]);
  });
});
