import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  softDeleteMediaIfUnreferencedCore,
  softDeleteMediaIfUnreferencedInTransaction,
} = await import(`${projectRoot}/src/lib/media/repository-core.ts`);

const client = new PGlite();
const database = drizzle(client, { schema });
const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "85000000-0000-4000-8000-000000000001";
const PROJECT_A = "85000000-0000-4000-8000-000000000002";
const PROJECT_B = "85000000-0000-4000-8000-000000000003";
const JOB_A = "85000000-0000-4000-8000-000000000004";
const JOB_B = "85000000-0000-4000-8000-000000000005";
const SESSION_A = "85000000-0000-4000-8000-000000000006";
const SESSION_B = "85000000-0000-4000-8000-000000000007";
const ATTACHMENT_SIGNATURE = "85000000-0000-4000-8000-000000000008";
const AI_WRITER_MEDIA = "85000000-0000-4000-8000-000000000011";
const SIGNATURE_DELETE_MEDIA = "85000000-0000-4000-8000-000000000012";
const MALFORMED_TARGET = "85000000-0000-4000-8000-000000000013";
const SAFE_TARGET = "85000000-0000-4000-8000-000000000014";
const DUPLICATE_TARGET = "85000000-0000-4000-8000-000000000015";
const AI_WRITER_MESSAGE = "85000000-0000-4000-8000-000000000021";
const SIGNATURE_DELETE_ID = "85000000-0000-4000-8000-000000000022";
const MALFORMED_MESSAGE_IDS = [
  "85000000-0000-4000-8000-000000000031",
  "85000000-0000-4000-8000-000000000032",
  "85000000-0000-4000-8000-000000000033",
];

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await client.exec(statement);
  }
}

function mediaValue(id, storeId, targetId) {
  return `(
    '${id}', '${storeId}', 'r2', 'private', 'project-document', '${targetId}',
    'projects', 'private-media', 'indirect/${id}.pdf', '${id}.pdf',
    'application/pdf', 16, 'ready', now() + interval '10 minutes'
  )`;
}

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql") && name < "0112_")
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }

  await client.exec(`
    insert into stores (id, slug) values ('${STORE_B}', 'media-indirect-b');
    insert into projects (id, store_id, name, service_type) values
      ('${PROJECT_A}', '${STORE_A}', 'Indirect A', 'camera'),
      ('${PROJECT_B}', '${STORE_B}', 'Indirect B', 'camera');
    insert into service_jobs (id, store_id, project_id, code, service_type, title) values
      ('${JOB_A}', '${STORE_A}', '${PROJECT_A}', 'INDIRECT-A', 'camera', 'Indirect A'),
      ('${JOB_B}', '${STORE_B}', '${PROJECT_B}', 'INDIRECT-B', 'camera', 'Indirect B');
    insert into ai_chat_sessions (id, store_id, title) values
      ('${SESSION_A}', '${STORE_A}', 'Session A'),
      ('${SESSION_B}', '${STORE_B}', 'Session B');
    insert into media_objects (
      id, store_id, provider, visibility, purpose, target_id, domain, bucket,
      object_key, original_file_name, mime_type, size_bytes, status, upload_expires_at
    ) values
      ${mediaValue(AI_WRITER_MEDIA, STORE_A, SESSION_A)},
      ${mediaValue(SIGNATURE_DELETE_MEDIA, STORE_A, JOB_A)},
      ${mediaValue(MALFORMED_TARGET, STORE_B, PROJECT_B)},
      ${mediaValue(SAFE_TARGET, STORE_B, PROJECT_B)},
      ${mediaValue(DUPLICATE_TARGET, STORE_B, SESSION_B)};
    insert into service_attachments (
      id, store_id, project_id, job_id, media_object_id, category, bucket,
      path, file_name, mime_type, size_bytes
    ) values (
      '${ATTACHMENT_SIGNATURE}', '${STORE_A}', '${PROJECT_A}', '${JOB_A}',
      '${SIGNATURE_DELETE_MEDIA}', 'signature', 'private-media',
      'indirect/signature.pdf', 'signature.pdf', 'application/pdf', 16
    );

    -- Legacy rows accepted before tenant-composite FKs and store-aware triggers.
    insert into ai_chat_messages (id, store_id, session_id, role, content, attachments) values
      ('${AI_WRITER_MESSAGE}', '${STORE_B}', '${SESSION_A}', 'user', 'writer',
       '[{"mediaId":"${AI_WRITER_MEDIA}"}]'::jsonb),
      ('${MALFORMED_MESSAGE_IDS[0]}', '${STORE_B}', '${SESSION_B}', 'user', 'object',
       '{"mediaId":"${MALFORMED_TARGET}"}'::jsonb),
      ('${MALFORMED_MESSAGE_IDS[1]}', '${STORE_B}', '${SESSION_B}', 'user', 'scalar', '9'::jsonb),
      ('${MALFORMED_MESSAGE_IDS[2]}', '${STORE_B}', '${SESSION_B}', 'user', 'invalid array',
       '[null,9,{"mediaId":"not-a-uuid"}]'::jsonb),
      (gen_random_uuid(), '${STORE_B}', '${SESSION_B}', 'user', 'null', null),
      (gen_random_uuid(), '${STORE_B}', '${SESSION_B}', 'user', 'missing', '[{"name":"safe"}]'::jsonb),
      (gen_random_uuid(), '${STORE_B}', '${SESSION_B}', 'user', 'duplicate',
       '[{"mediaId":"${DUPLICATE_TARGET}"},{"mediaId":"${DUPLICATE_TARGET}"}]'::jsonb);
    insert into service_signatures (
      id, store_id, project_id, job_id, attachment_id, signer_name, document_hash
    ) values (
      '${SIGNATURE_DELETE_ID}', '${STORE_B}', '${PROJECT_A}', '${JOB_A}',
      '${ATTACHMENT_SIGNATURE}', 'Customer', repeat('f', 64)
    );
    update service_attachments set deleted_at = now()
      where id = '${ATTACHMENT_SIGNATURE}';
    update service_signatures set invalidated_at = null, invalidation_reason = null
      where id = '${SIGNATURE_DELETE_ID}';
  `);

  await applySqlFile(`${projectRoot}/drizzle/0112_media_reference_delete_guard.sql`);
  await applySqlFile(`${projectRoot}/drizzle/0113_media_indirect_reference_hardening.sql`);
});

afterAll(async () => client.close());

describe("indirect media reference hardening", () => {
  test("store coordinates are trigger inputs and tenant composite FKs enforce new writes", async () => {
    const triggerDefinitions = await client.query(`
      select tgname, pg_get_triggerdef(oid) definition
      from pg_trigger
      where tgname in (
        'ai_chat_messages_ready_media_references',
        'service_signatures_ready_media_reference'
      ) order by tgname
    `);
    expect(triggerDefinitions.rows).toHaveLength(2);
    for (const trigger of triggerDefinitions.rows) expect(trigger.definition).toContain("store_id");

    const constraints = await client.query(`
      select conname, convalidated from pg_constraint
      where conname in (
        'ai_chat_messages_session_tenant_fk',
        'service_signatures_attachment_tenant_fk',
        'ai_chat_messages_attachments_shape_check'
      ) order by conname
    `);
    expect(constraints.rows).toEqual([
      { conname: "ai_chat_messages_attachments_shape_check", convalidated: false },
      { conname: "ai_chat_messages_session_tenant_fk", convalidated: false },
      { conname: "service_signatures_attachment_tenant_fk", convalidated: false },
    ]);

    await expect(client.exec(`
      insert into ai_chat_messages (store_id, session_id, role, content)
      values ('${STORE_B}', '${SESSION_A}', 'user', 'cross tenant')
    `)).rejects.toThrow();
    await expect(client.exec(`
      insert into service_signatures (
        store_id, project_id, job_id, attachment_id, signer_name, document_hash
      ) values (
        '${STORE_B}', '${PROJECT_A}', '${JOB_A}', '${ATTACHMENT_SIGNATURE}',
        'Cross tenant', repeat('a', 64)
      )
    `)).rejects.toThrow();
  });

  test("AI store-only writer wins before DELETE and leaves a live ready reference", async () => {
    let updated;
    const hasLock = new Promise((resolve) => { updated = resolve; });
    let release;
    const canCommit = new Promise((resolve) => { release = resolve; });
    const writing = database.transaction(async (tx) => {
      await tx.execute(sql`
        update ai_chat_messages set store_id = ${STORE_A}
        where id = ${AI_WRITER_MESSAGE}
      `);
      updated();
      await canCommit;
    });
    await hasLock;
    const deleting = softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_A,
      mediaId: AI_WRITER_MEDIA,
    });
    release();
    await writing;
    expect((await deleting).outcome).toBe("referenced");
  });

  test("signature DELETE wins before a store-only writer and rejects the new reference", async () => {
    let locked;
    const hasLock = new Promise((resolve) => { locked = resolve; });
    let release;
    const canDelete = new Promise((resolve) => { release = resolve; });
    const deleting = database.transaction(async (tx) => {
      await tx.execute(sql`
        select id from media_objects
        where store_id = ${STORE_A} and id = ${SIGNATURE_DELETE_MEDIA}
        for update
      `);
      locked();
      await canDelete;
      return softDeleteMediaIfUnreferencedInTransaction(tx, {
        storeId: STORE_A,
        mediaId: SIGNATURE_DELETE_MEDIA,
      });
    });
    await hasLock;
    const writing = client.exec(`
      update service_signatures set store_id = '${STORE_A}'
      where id = '${SIGNATURE_DELETE_ID}'
    `).then(() => null, (error) => error);
    release();
    expect((await deleting).outcome).toBe("deleted");
    expect(await writing).toBeInstanceOf(Error);
  });

  test("malformed legacy AI documents fail closed without throwing during delete scans", async () => {
    await expect(softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_B,
      mediaId: MALFORMED_TARGET,
    })).resolves.toMatchObject({ outcome: "conflict" });

    await client.exec(`delete from ai_chat_messages where id in (
      '${MALFORMED_MESSAGE_IDS.join("','")}'
    )`);
    await expect(softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_B,
      mediaId: SAFE_TARGET,
    })).resolves.toMatchObject({ outcome: "deleted" });
    await expect(softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_B,
      mediaId: DUPLICATE_TARGET,
    })).resolves.toMatchObject({ outcome: "referenced" });
  });
});
