import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const database = new PGlite();

const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "00000000-0000-4000-8000-000000000020";
const PROFILE_A = "00000000-0000-4000-8000-000000000021";
const PROFILE_B = "00000000-0000-4000-8000-000000000022";
const PROFILE_DELETE = "00000000-0000-4000-8000-000000000023";
const PRODUCT_A = "00000000-0000-4000-8000-000000000031";
const PRODUCT_B = "00000000-0000-4000-8000-000000000032";
const PROJECT_A = "00000000-0000-4000-8000-000000000041";
const PROJECT_B = "00000000-0000-4000-8000-000000000042";
const DOCUMENT_A = "00000000-0000-4000-8000-000000000051";
const DOCUMENT_B = "00000000-0000-4000-8000-000000000052";
const REQUEST_A = "00000000-0000-4000-8000-000000000061";
const MEDIA_A = "00000000-0000-4000-8000-000000000071";
const MEDIA_A_2 = "00000000-0000-4000-8000-000000000072";
const MEDIA_A_3 = "00000000-0000-4000-8000-000000000073";
const MEDIA_B = "00000000-0000-4000-8000-000000000074";
const MEDIA_DELETE_CREATOR = "00000000-0000-4000-8000-000000000075";
const RUN_A = "00000000-0000-4000-8000-000000000081";
const RUN_B = "00000000-0000-4000-8000-000000000082";
const RUN_DELETE_CREATOR = "00000000-0000-4000-8000-000000000083";

const mediaTables = [
  "media_objects",
  "product_media",
  "service_handover_document_media",
  "media_migration_runs",
  "media_migration_items",
];

async function applySqlFile(path) {
  const contents = readFileSync(path, "utf8");
  for (const statement of contents
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) {
      await database.exec(statement);
    }
  }
}

async function authenticatedQuery(profileId, statement) {
  await database.exec("begin");
  try {
    await database.exec(`select set_config('request.jwt.claim.sub', '${profileId}', true)`);
    await database.exec("set local role authenticated");
    return await database.query(statement);
  } finally {
    await database.exec("rollback");
  }
}

async function authenticatedOperationIsDenied(statement) {
  await database.exec("begin");
  try {
    await database.exec(`select set_config('request.jwt.claim.sub', '${PROFILE_A}', true)`);
    await database.exec("set local role authenticated");
    await database.exec(statement);
    return false;
  } catch {
    return true;
  } finally {
    await database.exec("rollback");
  }
}

function mediaValues(id, storeId, suffix, createdBy = null) {
  const creator = createdBy ? `'${createdBy}'` : "null";
  return `(
    '${id}', '${storeId}', 'r2', 'private', 'projects', 'private-media',
    'stores/${storeId}/projects/2026/08/${id}/original.pdf',
    '${suffix}.pdf', 'application/pdf', 1024, 'ready', ${creator}, now()
  )`;
}

beforeAll(async () => {
  await database.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
    end $$;
    alter default privileges in schema public grant all privileges on tables to anon;
    alter default privileges in schema public grant all privileges on tables to authenticated;
  `);

  for (const name of readdirSync(`${projectRoot}/drizzle`)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }

  await database.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    insert into stores (id, slug, status)
    values ('${STORE_B}', 'media-security-store-b', 'active');

    insert into profiles (id, store_id, full_name, role)
    values
      ('${PROFILE_A}', '${STORE_A}', 'Owner A', 'owner'),
      ('${PROFILE_B}', '${STORE_B}', 'Owner B', 'owner'),
      ('${PROFILE_DELETE}', '${STORE_A}', 'Temporary creator', 'manager');

    insert into products (id, store_id, sku, name)
    values
      ('${PRODUCT_A}', '${STORE_A}', 'MEDIA-A', 'Media product A'),
      ('${PRODUCT_B}', '${STORE_B}', 'MEDIA-B', 'Media product B');

    insert into brands (store_id, name)
    values ('${STORE_A}', 'Media brand A');

    insert into projects (id, store_id, name)
    values
      ('${PROJECT_A}', '${STORE_A}', 'Project A'),
      ('${PROJECT_B}', '${STORE_B}', 'Project B');

    insert into service_handover_documents (id, store_id, project_id, type, title)
    values
      ('${DOCUMENT_A}', '${STORE_A}', '${PROJECT_A}', 'handover', 'Document A'),
      ('${DOCUMENT_B}', '${STORE_B}', '${PROJECT_B}', 'handover', 'Document B');

    insert into service_customer_requests (
      id, store_id, code, project_id, title, contact_name, token_hash, token_expires_at
    ) values (
      '${REQUEST_A}', '${STORE_A}', 'REQ-MEDIA-A', '${PROJECT_A}',
      'Request A', 'Customer A', repeat('a', 64), now() + interval '1 day'
    );

    insert into media_objects (
      id, store_id, provider, visibility, domain, bucket, object_key,
      original_file_name, mime_type, size_bytes, status, created_by, created_at
    ) values
      ${mediaValues(MEDIA_A, STORE_A, "media-a", PROFILE_A)},
      ${mediaValues(MEDIA_A_2, STORE_A, "media-a-2")},
      ${mediaValues(MEDIA_A_3, STORE_A, "media-a-3")},
      ${mediaValues(MEDIA_B, STORE_B, "media-b", PROFILE_B)},
      ${mediaValues(MEDIA_DELETE_CREATOR, STORE_A, "creator-delete", PROFILE_DELETE)};

    insert into media_migration_runs (id, store_id, status, created_by)
    values
      ('${RUN_A}', '${STORE_A}', 'running', '${PROFILE_A}'),
      ('${RUN_B}', '${STORE_B}', 'running', '${PROFILE_B}'),
      ('${RUN_DELETE_CREATOR}', '${STORE_A}', 'pending', '${PROFILE_DELETE}');
  `);
});

afterAll(async () => database.close());

describe("media schema executable tenant security", () => {
  test("grants authenticated exactly SELECT and denies every write including TRUNCATE", async () => {
    const grants = await database.query(`
      select table_name, array_agg(privilege_type order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee = 'authenticated'
        and table_name = any(array[${mediaTables.map((table) => `'${table}'`).join(",")}])
      group by table_name
      order by table_name
    `);
    expect(grants.rows).toEqual(mediaTables.slice().sort().map((tableName) => ({
      table_name: tableName,
      privileges: ["SELECT"],
    })));

    for (const table of mediaTables) {
      expect(await authenticatedOperationIsDenied(`insert into ${table} default values`)).toBe(true);
      expect(await authenticatedOperationIsDenied(`update ${table} set store_id = store_id where false`)).toBe(true);
      expect(await authenticatedOperationIsDenied(`delete from ${table} where false`)).toBe(true);
      expect(await authenticatedOperationIsDenied(`truncate table ${table} cascade`)).toBe(true);
    }
  });

  test("enables one active-store authenticated SELECT policy on every media table", async () => {
    const policies = await database.query(`
      select tablename, cmd, roles, qual
      from pg_policies
      where schemaname = 'public'
        and tablename = any(array[${mediaTables.map((table) => `'${table}'`).join(",")}])
      order by tablename
    `);
    expect(policies.rows).toHaveLength(mediaTables.length);
    expect(policies.rows.every((row) =>
      row.cmd === "SELECT"
      && row.roles.includes("authenticated")
      && row.qual.includes("current_active_store_id")
    )).toBe(true);

    const activeRows = await authenticatedQuery(PROFILE_A, "select id, store_id from media_objects order by id");
    expect(activeRows.rows.length).toBeGreaterThan(0);
    expect(activeRows.rows.every((row) => row.store_id === STORE_A)).toBe(true);

    await database.exec(`update stores set status = 'suspended' where id = '${STORE_B}'`);
    const inactiveRows = await authenticatedQuery(PROFILE_B, "select id from media_objects");
    expect(inactiveRows.rows).toEqual([]);
  });

  test("rejects cross-store creators and preserves nullable creator SET NULL", async () => {
    await expect(database.exec(`
      insert into media_objects (
        id, store_id, provider, visibility, domain, bucket, object_key,
        original_file_name, mime_type, size_bytes, created_by
      ) values (
        '00000000-0000-4000-8000-000000000076', '${STORE_A}', 'r2', 'private',
        'projects', 'private-media', 'cross-store-creator-object', 'cross.pdf',
        'application/pdf', 1024, '${PROFILE_B}'
      )
    `)).rejects.toThrow();
    await expect(database.exec(`
      insert into media_migration_runs (id, store_id, created_by)
      values ('00000000-0000-4000-8000-000000000084', '${STORE_A}', '${PROFILE_B}')
    `)).rejects.toThrow();

    await database.exec(`delete from profiles where id = '${PROFILE_DELETE}'`);
    const media = await database.query(`select created_by from media_objects where id = '${MEDIA_DELETE_CREATOR}'`);
    const run = await database.query(`select created_by from media_migration_runs where id = '${RUN_DELETE_CREATOR}'`);
    expect(media.rows[0]?.created_by).toBeNull();
    expect(run.rows[0]?.created_by).toBeNull();
  });

  test("rejects cross-store values for every association and rollout media relation", async () => {
    const crossStoreStatements = [
      `insert into product_media (store_id, product_id, media_object_id) values ('${STORE_A}', '${PRODUCT_B}', '${MEDIA_A}')`,
      `insert into product_media (store_id, product_id, media_object_id) values ('${STORE_A}', '${PRODUCT_A}', '${MEDIA_B}')`,
      `insert into service_handover_document_media (store_id, document_id, media_object_id) values ('${STORE_A}', '${DOCUMENT_B}', '${MEDIA_A}')`,
      `insert into service_handover_document_media (store_id, document_id, media_object_id) values ('${STORE_A}', '${DOCUMENT_A}', '${MEDIA_B}')`,
      `update brands set logo_media_object_id = '${MEDIA_B}' where store_id = '${STORE_A}'`,
      `insert into service_attachments (
        store_id, project_id, media_object_id, category, bucket, path,
        file_name, mime_type, size_bytes
      ) values (
        '${STORE_A}', '${PROJECT_A}', '${MEDIA_B}', 'document', 'legacy',
        'cross-service-attachment', 'cross.pdf', 'application/pdf', 1024
      )`,
      `insert into service_customer_request_attachments (
        store_id, request_id, media_object_id, bucket, path, file_name,
        mime_type, size_bytes, sha256
      ) values (
        '${STORE_A}', '${REQUEST_A}', '${MEDIA_B}', 'legacy',
        'cross-request-attachment', 'cross.png', 'image/png', 1024, repeat('b', 64)
      )`,
      `insert into media_migration_items (
        store_id, run_id, source_provider, source_bucket, source_key, media_object_id
      ) values ('${STORE_A}', '${RUN_B}', 'supabase', 'legacy', 'cross-run', '${MEDIA_A}')`,
      `insert into media_migration_items (
        store_id, run_id, source_provider, source_bucket, source_key, media_object_id
      ) values ('${STORE_A}', '${RUN_A}', 'supabase', 'legacy', 'cross-media', '${MEDIA_B}')`,
    ];
    for (const statement of crossStoreStatements) {
      await expect(database.exec(statement)).rejects.toThrow();
    }
  });

  test("enforces active primary, resumability, and media-safe domain deletion", async () => {
    await database.exec(`
      insert into product_media (store_id, product_id, media_object_id, is_primary)
      values ('${STORE_A}', '${PRODUCT_A}', '${MEDIA_A}', true)
    `);
    await expect(database.exec(`
      insert into product_media (store_id, product_id, media_object_id, is_primary)
      values ('${STORE_A}', '${PRODUCT_A}', '${MEDIA_A_2}', true)
    `)).rejects.toThrow();
    await database.exec(`update product_media set deleted_at = now() where media_object_id = '${MEDIA_A}'`);
    await database.exec(`
      insert into product_media (store_id, product_id, media_object_id, is_primary)
      values ('${STORE_A}', '${PRODUCT_A}', '${MEDIA_A_2}', true)
    `);

    await database.exec(`
      insert into media_migration_items (
        store_id, run_id, source_provider, source_bucket, source_key, media_object_id
      ) values ('${STORE_A}', '${RUN_A}', 'supabase', 'legacy', 'same-key', '${MEDIA_A_3}')
    `);
    await expect(database.exec(`
      insert into media_migration_items (
        store_id, run_id, source_provider, source_bucket, source_key
      ) values ('${STORE_A}', '${RUN_A}', 'supabase', 'legacy', 'same-key')
    `)).rejects.toThrow();

    await expect(database.exec(`delete from media_objects where id = '${MEDIA_A_2}'`)).rejects.toThrow();
    await database.exec(`delete from products where id = '${PRODUCT_A}'`);
    const associations = await database.query(`select id from product_media where product_id = '${PRODUCT_A}'`);
    const canonical = await database.query(`select id from media_objects where id in ('${MEDIA_A}', '${MEDIA_A_2}') order by id`);
    expect(associations.rows).toEqual([]);
    expect(canonical.rows.map((row) => row.id)).toEqual([MEDIA_A, MEDIA_A_2]);
  });

  test("indexes every composite creator and media-side FK in FK column order", async () => {
    const expected = [
      "media_objects_store_created_by_idx",
      "media_migration_runs_store_created_by_idx",
      "product_media_store_media_object_idx",
      "service_handover_document_media_store_media_object_idx",
      "media_migration_items_store_media_object_idx",
    ];
    const indexes = await database.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = any(array[${expected.map((name) => `'${name}'`).join(",")}])
      order by indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expected.slice().sort());
    expect(indexes.rows.every((row) => /\(store_id, (created_by|media_object_id)\)/.test(row.indexdef))).toBe(true);
    expect(indexes.rows.find((row) => row.indexname === "media_migration_items_store_media_object_idx")?.indexdef)
      .toContain("WHERE (media_object_id IS NOT NULL)");
  });
});
