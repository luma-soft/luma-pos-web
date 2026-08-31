import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "10000000-0000-4000-8000-000000000001";
const MEDIA_ID = "20000000-0000-4000-8000-000000000001";
const database = new PGlite();

beforeAll(async () => {
  await database.exec(`
    create table ai_chat_messages (
      id uuid primary key,
      store_id uuid not null,
      attachments jsonb not null default '[]'::jsonb
    );
    insert into ai_chat_messages (id, store_id, attachments)
    values (
      '${MESSAGE_ID}',
      '${STORE_ID}',
      '[{"name":"camera.jpg","signedUrl":"https://legacy.test/file","bucket":"ai-attachments","path":"legacy/file"}]'::jsonb
    );
  `);
});

afterAll(async () => {
  await database.close();
});

test("AI media cutover and rollback bind JSONB values with PostgreSQL-safe types", async () => {
  const helpers = await import("../src/lib/media/ai-migration-sql").catch(
    () => null,
  );
  expect(helpers).not.toBeNull();
  if (!helpers) return;

  const cutover = helpers.buildAiAttachmentCutoverSql({
    sortOrder: 0,
    mediaId: MEDIA_ID,
    targetBucket: "lumapos-production-private-media",
    targetKey: "stores/store/ai/migration/media/original",
    storeId: STORE_ID,
    recordId: MESSAGE_ID,
  });
  await database.query(cutover.text, cutover.parameters);

  const afterCutover = await database.query<{ attachments: unknown[] }>(
    "select attachments from ai_chat_messages where id = $1::uuid",
    [MESSAGE_ID],
  );
  expect(afterCutover.rows[0]?.attachments).toEqual([
    {
      name: "camera.jpg",
      mediaId: MEDIA_ID,
      bucket: "lumapos-production-private-media",
      path: "stores/store/ai/migration/media/original",
    },
  ]);

  const rollback = helpers.buildAiAttachmentRollbackSql({
    sortOrder: 0,
    sourceBucket: "ai-attachments",
    sourceKey: "legacy/file",
    storeId: STORE_ID,
    recordId: MESSAGE_ID,
  });
  await database.query(rollback.text, rollback.parameters);

  const afterRollback = await database.query<{ attachments: unknown[] }>(
    "select attachments from ai_chat_messages where id = $1::uuid",
    [MESSAGE_ID],
  );
  expect(afterRollback.rows[0]?.attachments).toEqual([
    {
      name: "camera.jpg",
      bucket: "ai-attachments",
      path: "legacy/file",
    },
  ]);
});
