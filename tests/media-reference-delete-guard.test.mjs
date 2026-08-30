import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  mediaObjects,
  productMedia,
} = schema;
const {
  softDeleteMediaIfUnreferencedCore,
  softDeleteMediaIfUnreferencedInTransaction,
} = await import(`${projectRoot}/src/lib/media/repository-core.ts`);

const client = new PGlite();
const database = drizzle(client, { schema });

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const STORE_B = "84000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "84000000-0000-4000-8000-000000000002";
const PROJECT_ID = "84000000-0000-4000-8000-000000000003";
const JOB_ID = "84000000-0000-4000-8000-000000000004";
const DOCUMENT_ID = "84000000-0000-4000-8000-000000000005";
const REQUEST_ID = "84000000-0000-4000-8000-000000000006";
const BRAND_ID = "84000000-0000-4000-8000-000000000007";
const RUN_ID = "84000000-0000-4000-8000-000000000008";
const SESSION_ID = "84000000-0000-4000-8000-000000000009";

const ids = {
  brand: "84000000-0000-4000-8000-000000000011",
  product: "84000000-0000-4000-8000-000000000012",
  attachment: "84000000-0000-4000-8000-000000000013",
  customer: "84000000-0000-4000-8000-000000000014",
  handover: "84000000-0000-4000-8000-000000000015",
  migration: "84000000-0000-4000-8000-000000000016",
  signature: "84000000-0000-4000-8000-000000000017",
  ai: "84000000-0000-4000-8000-000000000018",
  pending: "84000000-0000-4000-8000-000000000019",
  deleted: "84000000-0000-4000-8000-000000000020",
  deleteFirst: "84000000-0000-4000-8000-000000000021",
  writerFirst: "84000000-0000-4000-8000-000000000022",
  foreign: "84000000-0000-4000-8000-000000000023",
};

function mediaValue(id, status = "ready", storeId = STORE_ID) {
  return `(
    '${id}', '${storeId}', 'r2', 'private', 'project-document',
    '${storeId === STORE_ID ? PROJECT_ID : STORE_B}', 'projects', 'private-media',
    'stores/${storeId}/projects/2026/08/${id}/original.pdf', '${id}.pdf',
    'application/pdf', 16, '${status}', now() + interval '10 minutes'
  )`;
}

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await client.exec(statement);
  }
}

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }

  await client.exec(`
    insert into stores (id, slug) values ('${STORE_B}', 'media-delete-guard-b');
    insert into products (id, store_id, sku, name)
    values ('${PRODUCT_ID}', '${STORE_ID}', 'DELETE-GUARD', 'Delete guard product');
    insert into projects (id, store_id, name, service_type)
    values ('${PROJECT_ID}', '${STORE_ID}', 'Delete guard project', 'camera');
    insert into service_jobs (id, store_id, project_id, code, service_type, title)
    values ('${JOB_ID}', '${STORE_ID}', '${PROJECT_ID}', 'DELETE-GUARD', 'camera', 'Delete guard job');
    insert into service_handover_documents (id, store_id, project_id, type, title)
    values ('${DOCUMENT_ID}', '${STORE_ID}', '${PROJECT_ID}', 'handover', 'Delete guard document');
    insert into service_customer_requests (
      id, store_id, code, project_id, title, contact_name, token_hash, token_expires_at
    ) values (
      '${REQUEST_ID}', '${STORE_ID}', 'DELETE-GUARD-REQUEST', '${PROJECT_ID}',
      'Delete guard request', 'Customer', repeat('a', 64), now() + interval '1 day'
    );
    insert into brands (id, store_id, name)
    values ('${BRAND_ID}', '${STORE_ID}', 'Delete guard brand');
    insert into media_migration_runs (id, store_id, status)
    values ('${RUN_ID}', '${STORE_ID}', 'running');
    insert into ai_chat_sessions (id, store_id, title)
    values ('${SESSION_ID}', '${STORE_ID}', 'Delete guard AI');

    insert into media_objects (
      id, store_id, provider, visibility, purpose, target_id, domain, bucket,
      object_key, original_file_name, mime_type, size_bytes, status, upload_expires_at
    ) values
      ${Object.entries(ids).map(([name, id]) =>
        mediaValue(
          id,
          name === "pending" ? "pending" : name === "deleted" ? "deleted" : "ready",
          name === "foreign" ? STORE_B : STORE_ID,
        )
      ).join(",")};

    update brands set logo_media_object_id = '${ids.brand}' where id = '${BRAND_ID}';
    insert into product_media (store_id, product_id, media_object_id)
    values ('${STORE_ID}', '${PRODUCT_ID}', '${ids.product}');
    insert into service_attachments (
      id, store_id, project_id, job_id, media_object_id, category, bucket,
      path, file_name, mime_type, size_bytes
    ) values (
      '84000000-0000-4000-8000-000000000031', '${STORE_ID}', '${PROJECT_ID}',
      '${JOB_ID}', '${ids.attachment}', 'before', 'private-media',
      'guard/attachment.pdf', 'attachment.pdf', 'application/pdf', 16
    ), (
      '84000000-0000-4000-8000-000000000032', '${STORE_ID}', '${PROJECT_ID}',
      '${JOB_ID}', '${ids.signature}', 'signature', 'private-media',
      'guard/signature.pdf', 'signature.pdf', 'application/pdf', 16
    );
    insert into service_signatures (
      store_id, project_id, job_id, attachment_id, signer_name, document_hash
    ) values (
      '${STORE_ID}', '${PROJECT_ID}', '${JOB_ID}',
      '84000000-0000-4000-8000-000000000032', 'Customer', repeat('b', 64)
    );
    update service_attachments set deleted_at = now()
      where id = '84000000-0000-4000-8000-000000000032';
    update service_signatures
      set invalidated_at = null, invalidation_reason = null
      where attachment_id = '84000000-0000-4000-8000-000000000032';
    insert into service_customer_request_attachments (
      store_id, request_id, media_object_id, bucket, path, file_name, mime_type,
      size_bytes, sha256
    ) values (
      '${STORE_ID}', '${REQUEST_ID}', '${ids.customer}', 'private-media',
      'guard/customer.png', 'customer.png', 'image/png', 16, repeat('c', 64)
    );
    insert into service_handover_document_media (store_id, document_id, media_object_id)
    values ('${STORE_ID}', '${DOCUMENT_ID}', '${ids.handover}');
    insert into media_migration_items (
      store_id, run_id, source_provider, source_bucket, source_key, media_object_id, status
    ) values (
      '${STORE_ID}', '${RUN_ID}', 'supabase', 'legacy', 'guard/migration',
      '${ids.migration}', 'verified'
    );
    insert into ai_chat_messages (store_id, session_id, role, content, attachments)
    values (
      '${STORE_ID}', '${SESSION_ID}', 'user', 'attachment',
      '[{"mediaId":"${ids.ai}"}]'::jsonb
    );
  `);
});

afterAll(async () => client.close());

describe("DB-enforced media reference/delete protocol", () => {
  test("every live reference surface atomically blocks soft deletion", async () => {
    const signatureReference = await client.query(`
      select signature.id
      from service_signatures signature
      join service_attachments attachment
        on attachment.id = signature.attachment_id
       and attachment.store_id = signature.store_id
      where signature.store_id = '${STORE_ID}'
        and signature.invalidated_at is null
        and attachment.media_object_id = '${ids.signature}'
    `);
    expect(signatureReference.rows).toHaveLength(1);
    for (const [surface, mediaId] of Object.entries({
      brand: ids.brand,
      product: ids.product,
      attachment: ids.attachment,
      customer: ids.customer,
      handover: ids.handover,
      migration: ids.migration,
      signature: ids.signature,
      ai: ids.ai,
    })) {
      const result = await softDeleteMediaIfUnreferencedCore(database, {
        storeId: STORE_ID,
        mediaId,
        deletedAt: new Date("2026-08-30T04:00:00.000Z"),
      });
      expect(result.outcome, surface).toBe("referenced");
      const [media] = await database.select({ status: mediaObjects.status })
        .from(mediaObjects).where(eq(mediaObjects.id, mediaId));
      expect(media.status, surface).toBe("ready");
    }
  });

  test("reference writers reject pending, deleted, and cross-store media", async () => {
    await expect(Promise.resolve(database.update(schema.brands)
      .set({ logoMediaObjectId: ids.pending })
      .where(eq(schema.brands.id, BRAND_ID)))).rejects.toThrow();
    await expect(Promise.resolve(database.insert(schema.mediaMigrationItems).values({
      storeId: STORE_ID,
      runId: RUN_ID,
      sourceProvider: "supabase",
      sourceBucket: "legacy",
      sourceKey: "guard/deleted",
      mediaObjectId: ids.deleted,
    }))).rejects.toThrow();
    await expect(Promise.resolve(database.insert(schema.aiChatMessages).values({
      storeId: STORE_ID,
      sessionId: SESSION_ID,
      role: "user",
      content: "cross-store",
      attachments: [{ mediaId: ids.foreign }],
    }))).rejects.toThrow();
  });

  test("delete-first ordering serializes a concurrent writer and rejects its reference", async () => {
    let locked;
    const hasLock = new Promise((resolve) => { locked = resolve; });
    let release;
    const canDelete = new Promise((resolve) => { release = resolve; });

    const deleting = database.transaction(async (tx) => {
      await tx.execute(sql`
        select ${mediaObjects.id} from ${mediaObjects}
        where ${mediaObjects.storeId} = ${STORE_ID}
          and ${mediaObjects.id} = ${ids.deleteFirst}
        for update
      `);
      locked();
      await canDelete;
      return softDeleteMediaIfUnreferencedInTransaction(tx, {
        storeId: STORE_ID,
        mediaId: ids.deleteFirst,
        deletedAt: new Date("2026-08-30T04:00:00.000Z"),
      });
    });
    await hasLock;
    const insertion = database.insert(productMedia).values({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      mediaObjectId: ids.deleteFirst,
    }).then(() => null, (error) => error);
    release();

    expect((await deleting).outcome).toBe("deleted");
    expect(await insertion).toBeInstanceOf(Error);
  });

  test("writer-first ordering commits its shared lock before DELETE checks references", async () => {
    let inserted;
    const hasReference = new Promise((resolve) => { inserted = resolve; });
    let release;
    const canCommit = new Promise((resolve) => { release = resolve; });

    const writing = database.transaction(async (tx) => {
      await tx.insert(productMedia).values({
        storeId: STORE_ID,
        productId: PRODUCT_ID,
        mediaObjectId: ids.writerFirst,
      });
      inserted();
      await canCommit;
    });
    await hasReference;
    const deleting = softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_ID,
      mediaId: ids.writerFirst,
      deletedAt: new Date("2026-08-30T04:00:00.000Z"),
    });
    release();

    await writing;
    expect((await deleting).outcome).toBe("referenced");
  });
});
