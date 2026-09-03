import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  mediaObjects,
  serviceAttachments,
  serviceHandoverDocuments,
} = schema;
const {
  recoverReadyMediaAfterFailureInTransaction,
  softDeleteMediaIfUnreferencedCore,
} = await import(`${projectRoot}/src/lib/media/repository-core.ts`);
const {
  compensateManagedMediaAssociation,
  createDatabaseMediaRepository,
  createDatabaseProjectMediaRepository,
  createProjectMediaManager,
  resolveManagedPrivateMediaUrl,
} = await import(`${projectRoot}/src/lib/media/project-media.ts`);

const client = new PGlite();
const database = drizzle(client, { schema });
const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "85000000-0000-4000-8000-000000000001";
const STORE_C = "8aabcdef-abcd-4def-8abc-defabcdef041";
const PROJECT_A = "8babcdef-abcd-4def-8abc-defabcdef002";
const PROJECT_B = "85000000-0000-4000-8000-000000000003";
const PROJECT_C = "8cabcdef-abcd-4def-8abc-defabcdef042";
const JOB_A = "85000000-0000-4000-8000-000000000004";
const JOB_B = "85000000-0000-4000-8000-000000000005";
const SESSION_A = "85000000-0000-4000-8000-000000000006";
const SESSION_B = "85000000-0000-4000-8000-000000000007";
const SESSION_C = "85000000-0000-4000-8000-000000000043";
const ATTACHMENT_SIGNATURE = "85000000-0000-4000-8000-000000000008";
const AI_WRITER_MEDIA = "85000000-0000-4000-8000-000000000011";
const SIGNATURE_DELETE_MEDIA = "85000000-0000-4000-8000-000000000012";
const MALFORMED_TARGET = "85000000-0000-4000-8000-000000000013";
const SAFE_TARGET = "85000000-0000-4000-8000-000000000014";
const DUPLICATE_TARGET = "85000000-0000-4000-8000-000000000015";
const RECOVERY_UNREFERENCED = "8dabcdef-abcd-4def-8abc-defabcdef044";
const RECOVERY_MALFORMED = "8eabcdef-abcd-4def-8abc-defabcdef045";
const RECOVERY_REFERENCED = "85abcdef-abcd-4def-8abc-defabcdef046";
const RECOVERY_CONFLICT = "85000000-0000-4000-8000-000000000047";
const RECOVERY_MANAGER_MEDIA = "85000000-0000-4000-8000-000000000051";
const RECOVERY_MANAGER_USER = "8fabcdef-abcd-4def-8abc-defabcdef052";
const RECOVERY_MANAGER_DOCUMENT = "85000000-0000-4000-8000-000000000053";
const UUID_ASSOCIATION_MEDIA = "81abcdef-abcd-4def-8abc-defabcdef054";
const UUID_ASSOCIATION_REQUEST = "81abcdef-abcd-4def-8abc-defabcdef058";
const RECOVERY_MANAGER_REQUEST = "85000000-0000-4000-8000-000000000059";
const UUID_CREATOR_MEDIA = "82abcdef-abcd-4def-8abc-defabcdef055";
const UUID_SOFT_DELETE_MEDIA = "83abcdef-abcd-4def-8abc-defabcdef056";
const UUID_PORTAL_MEDIA = "84abcdef-abcd-4def-8abc-defabcdef057";
const AI_WRITER_MESSAGE = "85000000-0000-4000-8000-000000000021";
const SIGNATURE_DELETE_ID = "85000000-0000-4000-8000-000000000022";
const RECOVERY_MALFORMED_MESSAGE = "85000000-0000-4000-8000-000000000048";
const RECOVERY_REFERENCE_MESSAGE = "85000000-0000-4000-8000-000000000049";
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
    insert into stores (id, slug) values
      ('${STORE_B}', 'media-indirect-b'),
      ('${STORE_C}', 'media-indirect-c');
    insert into profiles (id, store_id, full_name, role) values
      ('${RECOVERY_MANAGER_USER}', '${STORE_C}', 'Recovery manager', 'manager');
    insert into projects (id, store_id, name, service_type) values
      ('${PROJECT_A}', '${STORE_A}', 'Indirect A', 'camera'),
      ('${PROJECT_B}', '${STORE_B}', 'Indirect B', 'camera'),
      ('${PROJECT_C}', '${STORE_C}', 'Indirect C', 'camera');
    insert into service_jobs (id, store_id, project_id, code, service_type, title) values
      ('${JOB_A}', '${STORE_A}', '${PROJECT_A}', 'INDIRECT-A', 'camera', 'Indirect A'),
      ('${JOB_B}', '${STORE_B}', '${PROJECT_B}', 'INDIRECT-B', 'camera', 'Indirect B');
    insert into ai_chat_sessions (id, store_id, title) values
      ('${SESSION_A}', '${STORE_A}', 'Session A'),
      ('${SESSION_B}', '${STORE_B}', 'Session B'),
      ('${SESSION_C}', '${STORE_C}', 'Session C');
    insert into media_objects (
      id, store_id, provider, visibility, purpose, target_id, domain, bucket,
      object_key, original_file_name, mime_type, size_bytes, status, upload_expires_at
    ) values
      ${mediaValue(AI_WRITER_MEDIA, STORE_A, SESSION_A)},
      ${mediaValue(SIGNATURE_DELETE_MEDIA, STORE_A, JOB_A)},
      ${mediaValue(MALFORMED_TARGET, STORE_B, PROJECT_B)},
      ${mediaValue(SAFE_TARGET, STORE_B, PROJECT_B)},
      ${mediaValue(DUPLICATE_TARGET, STORE_B, SESSION_B)},
      ${mediaValue(RECOVERY_UNREFERENCED, STORE_A, PROJECT_A)},
      ${mediaValue(RECOVERY_MALFORMED, STORE_C, PROJECT_C)},
      ${mediaValue(RECOVERY_REFERENCED, STORE_C, PROJECT_C)},
      ${mediaValue(RECOVERY_CONFLICT, STORE_C, PROJECT_C)},
      ${mediaValue(RECOVERY_MANAGER_MEDIA, STORE_C, PROJECT_C)},
      ${mediaValue(UUID_ASSOCIATION_MEDIA, STORE_C, PROJECT_C)},
      ${mediaValue(UUID_CREATOR_MEDIA, STORE_C, PROJECT_C)},
      ${mediaValue(UUID_SOFT_DELETE_MEDIA, STORE_A, PROJECT_A)};
    update media_objects set created_by = '${RECOVERY_MANAGER_USER}'
      where id in (
        '${RECOVERY_MANAGER_MEDIA}',
        '${UUID_ASSOCIATION_MEDIA}',
        '${UUID_CREATOR_MEDIA}'
      );
    insert into service_handover_documents (
      id, store_id, project_id, type, title
    ) values (
      '${RECOVERY_MANAGER_DOCUMENT}', '${STORE_C}', '${PROJECT_C}',
      'handover', 'Recovery race document'
    );
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
       '[{"mediaId":"${DUPLICATE_TARGET}"},{"mediaId":"${DUPLICATE_TARGET}"}]'::jsonb),
      ('${RECOVERY_MALFORMED_MESSAGE}', '${STORE_C}', '${SESSION_C}', 'user', 'legacy malformed',
       '{"mediaId":"${RECOVERY_MALFORMED}"}'::jsonb),
      ('${RECOVERY_REFERENCE_MESSAGE}', '${STORE_C}', '${SESSION_C}', 'user', 'known live reference',
       '[{"mediaId":"${RECOVERY_REFERENCED.toUpperCase()}"}]'::jsonb);
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
  await applySqlFile(`${projectRoot}/drizzle/0119_media_cleanup_leases.sql`);
  await applySqlFile(`${projectRoot}/drizzle/0120_media_library.sql`);
  await applySqlFile(`${projectRoot}/drizzle/0121_media_file_metadata.sql`);
});

afterAll(async () => client.close());

describe("indirect media reference hardening", () => {
  function recoveryInput(mediaId, overrides = {}) {
    return {
      storeId: mediaId === RECOVERY_UNREFERENCED ? STORE_A : STORE_C,
      mediaId,
      purpose: "project-document",
      targetId: mediaId === RECOVERY_UNREFERENCED ? PROJECT_A : PROJECT_C,
      expectedObjectKey: `indirect/${mediaId}.pdf`,
      expectedCreatedBy: null,
      ...overrides,
    };
  }

  test("association recovery deletes an ordinary unreferenced ready object", async () => {
    await expect(compensateManagedMediaAssociation(
      database,
      recoveryInput(RECOVERY_UNREFERENCED, {
        mediaId: RECOVERY_UNREFERENCED.toUpperCase(),
        targetId: PROJECT_A.toUpperCase(),
      }),
    )).resolves.toMatchObject({ outcome: "deleted" });
    await expect(compensateManagedMediaAssociation(
      database,
      recoveryInput(RECOVERY_UNREFERENCED, {
        mediaId: RECOVERY_UNREFERENCED.toUpperCase(),
        targetId: PROJECT_A.toUpperCase(),
      }),
    )).resolves.toMatchObject({ outcome: "deleted" });
    const media = await client.query(
      `select status, deleted_at is not null as deleted from media_objects where id = '${RECOVERY_UNREFERENCED}'`,
    );
    expect(media.rows).toEqual([{ status: "deleted", deleted: true }]);
  });

  test("association recovery quarantines malformed-reference uncertainty and is repeatable", async () => {
    await expect(compensateManagedMediaAssociation(
      database,
      recoveryInput(RECOVERY_MALFORMED, {
        storeId: STORE_C.toUpperCase(),
        mediaId: RECOVERY_MALFORMED.toUpperCase(),
        targetId: PROJECT_C.toUpperCase(),
      }),
    )).resolves.toMatchObject({ outcome: "quarantined" });
    await expect(compensateManagedMediaAssociation(
      database,
      recoveryInput(RECOVERY_MALFORMED, {
        storeId: STORE_C.toUpperCase(),
        mediaId: RECOVERY_MALFORMED.toUpperCase(),
        targetId: PROJECT_C.toUpperCase(),
      }),
    )).resolves.toMatchObject({ outcome: "quarantined" });

    const media = await client.query(
      `select status, deleted_at from media_objects where id = '${RECOVERY_MALFORMED}'`,
    );
    expect(media.rows).toEqual([{ status: "quarantined", deleted_at: null }]);

    let signed = 0;
    await expect(resolveManagedPrivateMediaUrl({
      storeId: STORE_C,
      userId: "85000000-0000-4000-8000-000000000050",
      role: "manager",
      features: { field_services: true },
    }, RECOVERY_MALFORMED, {
      database,
      authorizeTarget: async () => "allowed",
      storageForProvider: () => ({
        async createDownloadUrl() {
          signed += 1;
          return "https://should-not-sign.test";
        },
      }),
    })).rejects.toMatchObject({ status: 404 });
    expect(signed).toBe(0);
  });

  test("association recovery protects a case-insensitive live UUID reference despite malformed rows", async () => {
    await expect(compensateManagedMediaAssociation(
      database,
      recoveryInput(RECOVERY_REFERENCED, {
        storeId: STORE_C.toUpperCase(),
        mediaId: RECOVERY_REFERENCED.toUpperCase(),
        targetId: PROJECT_C.toUpperCase(),
      }),
    )).resolves.toMatchObject({ outcome: "referenced" });
    const media = await client.query(
      `select status from media_objects where id = '${RECOVERY_REFERENCED}'`,
    );
    expect(media.rows).toEqual([{ status: "ready" }]);
  });

  test("association recovery rejects coordinate conflicts and propagates database exceptions", async () => {
    await expect(compensateManagedMediaAssociation(database, recoveryInput(
      RECOVERY_CONFLICT,
      { expectedObjectKey: "indirect/not-this-upload.pdf" },
    ))).rejects.toThrow("MANAGED_MEDIA_RECOVERY_CONFLICT");
    await expect(compensateManagedMediaAssociation(database, recoveryInput(
      RECOVERY_CONFLICT,
      { expectedCreatedBy: RECOVERY_MANAGER_USER },
    ))).rejects.toThrow("MANAGED_MEDIA_RECOVERY_CONFLICT");
    await expect(compensateManagedMediaAssociation(database, recoveryInput(
      RECOVERY_CONFLICT,
      { storeId: STORE_A },
    ))).rejects.toThrow("MANAGED_MEDIA_RECOVERY_CONFLICT");
    await expect(compensateManagedMediaAssociation(database, recoveryInput(
      RECOVERY_CONFLICT,
      { purpose: "service-evidence" },
    ))).rejects.toThrow("MANAGED_MEDIA_RECOVERY_CONFLICT");
    await expect(compensateManagedMediaAssociation(database, recoveryInput(
      RECOVERY_CONFLICT,
      { targetId: PROJECT_B },
    ))).rejects.toThrow("MANAGED_MEDIA_RECOVERY_CONFLICT");
    const media = await client.query(
      `select status from media_objects where id = '${RECOVERY_CONFLICT}'`,
    );
    expect(media.rows).toEqual([{ status: "ready" }]);

    await expect(compensateManagedMediaAssociation({
      async transaction() {
        throw new Error("recovery database unavailable");
      },
    }, recoveryInput(RECOVERY_CONFLICT))).rejects.toThrow(
      "recovery database unavailable",
    );
  });

  test("association accepts UUID-equivalent casing and keeps the opaque object key exact", async () => {
    const repository = createDatabaseProjectMediaRepository(database);
    const created = await repository.createProjectAttachment({
      storeId: STORE_C.toUpperCase(),
      actorId: RECOVERY_MANAGER_USER.toUpperCase(),
      projectId: PROJECT_C.toUpperCase(),
      mediaId: UUID_ASSOCIATION_MEDIA.toUpperCase(),
      expectedPath: `indirect/${UUID_ASSOCIATION_MEDIA}.pdf`,
      phase: "handover",
      caption: null,
      fileName: `${UUID_ASSOCIATION_MEDIA}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 16,
      sha256: "c".repeat(64),
      idempotencyKey: UUID_ASSOCIATION_REQUEST,
    });
    expect(created).toMatchObject({ mediaId: UUID_ASSOCIATION_MEDIA });
    await expect(compensateManagedMediaAssociation(database, {
      storeId: STORE_C.toUpperCase(),
      mediaId: UUID_ASSOCIATION_MEDIA.toUpperCase(),
      purpose: "project-document",
      targetId: PROJECT_C.toUpperCase(),
      expectedObjectKey: `indirect/${UUID_ASSOCIATION_MEDIA}.pdf`,
      expectedCreatedBy: RECOVERY_MANAGER_USER.toUpperCase(),
    })).resolves.toMatchObject({ outcome: "referenced" });
  });

  test("recovery canonicalizes a non-null creator and terminal retries", async () => {
    const input = {
      storeId: STORE_C.toUpperCase(),
      mediaId: UUID_CREATOR_MEDIA.toUpperCase(),
      purpose: "project-document",
      targetId: PROJECT_C.toUpperCase(),
      expectedObjectKey: `indirect/${UUID_CREATOR_MEDIA}.pdf`,
      expectedCreatedBy: RECOVERY_MANAGER_USER.toUpperCase(),
    };
    await expect(compensateManagedMediaAssociation(database, input))
      .resolves.toMatchObject({ outcome: "quarantined" });
    await expect(compensateManagedMediaAssociation(database, input))
      .resolves.toMatchObject({ outcome: "quarantined" });
  });

  test("portal recovery retains a null creator while canonicalizing UUID coordinates", async () => {
    const repository = createDatabaseMediaRepository(database, { forceCreatedByNull: true });
    const pending = await repository.createPending({
      id: UUID_PORTAL_MEDIA.toUpperCase(),
      storeId: STORE_C.toUpperCase(),
      provider: "r2",
      visibility: "private",
      purpose: "project-document",
      targetId: PROJECT_C.toUpperCase(),
      domain: "projects",
      bucket: "private-media",
      objectKey: `indirect/${UUID_PORTAL_MEDIA}.pdf`,
      originalFileName: `${UUID_PORTAL_MEDIA}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 16,
      uploadExpiresAt: new Date(Date.now() + 60_000),
      createdBy: RECOVERY_MANAGER_USER.toUpperCase(),
    });
    expect(pending).toMatchObject({
      id: UUID_PORTAL_MEDIA,
      storeId: STORE_C,
      targetId: PROJECT_C,
      createdBy: null,
    });
    await repository.markReady({
      storeId: STORE_C.toUpperCase(),
      mediaId: UUID_PORTAL_MEDIA.toUpperCase(),
      actualSizeBytes: 16,
      readyAt: new Date(),
      verifiedAt: new Date(),
    });
    await expect(compensateManagedMediaAssociation(database, {
      storeId: STORE_C.toUpperCase(),
      mediaId: UUID_PORTAL_MEDIA.toUpperCase(),
      purpose: "project-document",
      targetId: PROJECT_C.toUpperCase(),
      expectedObjectKey: `indirect/${UUID_PORTAL_MEDIA}.pdf`,
      expectedCreatedBy: null,
    })).resolves.toMatchObject({ outcome: "quarantined" });
  });

  test("private resolution and soft delete honor PostgreSQL UUID equivalence", async () => {
    const authorizedCoordinates = [];
    const url = await resolveManagedPrivateMediaUrl({
      storeId: STORE_C.toUpperCase(),
      userId: RECOVERY_MANAGER_USER.toUpperCase(),
      role: "manager",
      features: { field_services: true },
    }, RECOVERY_CONFLICT.toUpperCase(), {
      database,
      expectedPurpose: "project-document",
      expectedTargetId: PROJECT_C.toUpperCase(),
      authorizeTarget: async (input) => {
        authorizedCoordinates.push(input);
        return "allowed";
      },
      storageForProvider: () => ({
        async createDownloadUrl(input) {
          return `https://r2.test/${input.key}`;
        },
      }),
    });
    expect(url).toBe(`https://r2.test/indirect/${RECOVERY_CONFLICT}.pdf`);
    expect(authorizedCoordinates).toEqual([{
      actor: {
        storeId: STORE_C,
        userId: RECOVERY_MANAGER_USER,
        role: "manager",
        features: { field_services: true },
      },
      purpose: "project-document",
      targetId: PROJECT_C,
    }]);

    await expect(softDeleteMediaIfUnreferencedCore(database, {
      storeId: STORE_A.toUpperCase(),
      mediaId: UUID_SOFT_DELETE_MEDIA.toUpperCase(),
      expectedPurpose: "project-document",
      expectedTargetId: PROJECT_A.toUpperCase(),
    })).resolves.toMatchObject({ outcome: "deleted" });
  });

  test("a document race after prevalidation durably recovers the uploaded media", async () => {
    const realRepository = createDatabaseProjectMediaRepository(database);
    const manager = createProjectMediaManager({
      authorizeProject: async () => "allowed",
      repository: {
        ...realRepository,
        async validateProjectDocument(input) {
          await realRepository.validateProjectDocument(input);
          await database.delete(serviceHandoverDocuments).where(sql`
            ${serviceHandoverDocuments.id} = ${input.documentId}
          `);
        },
        async reserveProjectAttachment(input) {
          return {
            record: {
              id: input.idempotencyKey,
              mediaId: RECOVERY_MANAGER_MEDIA,
              phase: input.phase,
              caption: input.caption,
              fileName: input.fileName,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
              createdAt: new Date(),
              provider: "r2",
              bucket: "private-media",
              objectKey: `indirect/${RECOVERY_MANAGER_MEDIA}.pdf`,
            },
            documentIds: [input.documentId],
            sha256: input.sha256,
            mediaStatus: "ready",
          };
        },
      },
      mediaService: {
        async reserveManagedObject() {
          return {
            mediaId: RECOVERY_MANAGER_MEDIA,
            path: `indirect/${RECOVERY_MANAGER_MEDIA}.pdf`,
            status: "ready",
            created: false,
          };
        },
        async putReservedManagedObject() {
          return {
            mediaId: RECOVERY_MANAGER_MEDIA,
            path: `indirect/${RECOVERY_MANAGER_MEDIA}.pdf`,
            url: "https://r2.test/fresh-signed-url",
          };
        },
      },
      async sign() {
        throw new Error("association failure must not reach signing");
      },
      compensate: (input) => compensateManagedMediaAssociation(database, input),
      logger: { error() {} },
    });

    await expect(manager.upload({
      storeId: STORE_C.toUpperCase(),
      userId: RECOVERY_MANAGER_USER.toUpperCase(),
      role: "manager",
      features: { field_services: true },
    }, PROJECT_C.toUpperCase(), {
      phase: "handover",
      caption: null,
      documentId: RECOVERY_MANAGER_DOCUMENT.toUpperCase(),
      fileName: `${RECOVERY_MANAGER_MEDIA}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 16,
      sha256: "a".repeat(64),
      idempotencyKey: RECOVERY_MANAGER_REQUEST,
    }, new Uint8Array(16))).rejects.toMatchObject({
      code: "PROJECT_MEDIA_DOCUMENT_NOT_FOUND",
    });

    const [media] = await database.select().from(mediaObjects).where(sql`
      ${mediaObjects.id} = ${RECOVERY_MANAGER_MEDIA}
    `);
    expect(media).toMatchObject({ status: "quarantined", deletedAt: null });
    expect(await database.select().from(serviceAttachments).where(sql`
      ${serviceAttachments.mediaObjectId} = ${RECOVERY_MANAGER_MEDIA}
    `)).toHaveLength(0);
  });

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

  test("AI store-only writer wins before recovery and leaves a live ready reference", async () => {
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
    const recovering = compensateManagedMediaAssociation(database, {
      storeId: STORE_A,
      mediaId: AI_WRITER_MEDIA,
      purpose: "project-document",
      targetId: SESSION_A,
      expectedObjectKey: `indirect/${AI_WRITER_MEDIA}.pdf`,
      expectedCreatedBy: null,
    });
    release();
    await writing;
    expect((await recovering).outcome).toBe("referenced");
  });

  test("signature recovery wins before a store-only writer and rejects the new reference", async () => {
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
      return recoverReadyMediaAfterFailureInTransaction(tx, {
        storeId: STORE_A,
        mediaId: SIGNATURE_DELETE_MEDIA,
        expectedPurpose: "project-document",
        expectedTargetId: JOB_A,
        expectedObjectKey: `indirect/${SIGNATURE_DELETE_MEDIA}.pdf`,
        expectedCreatedBy: null,
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
