import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { mediaObjects } from "../src/db/schema";
import { buildSaveMediaMetadataQuery, mediaRecordWithMetadata } from "../src/lib/media/file-metadata-repository";
import type { MediaFileMetadata } from "../src/lib/media/file-metadata-types";

const storeId = "11111111-1111-4111-8111-111111111111";
const otherStoreId = "22222222-2222-4222-8222-222222222222";
const mediaId = "33333333-3333-4333-8333-333333333333";
const valid: MediaFileMetadata = {
  version: 1, status: "ready", extractedAt: "2026-09-03T00:00:00Z",
  latitude: 0, longitude: 0, capturedAt: "2026-08-01T10:00:00",
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$;
    create table media_objects (
      id uuid primary key, store_id uuid not null, object_key text,
      status text default 'ready', purpose text default 'project-document',
      visibility text default 'private', deleted_at timestamptz,
      unique(store_id, id)
    );
    insert into media_objects (id, store_id, object_key)
      values ('${mediaId}', '${storeId}', 'unchanged/original.jpg');
    alter table media_objects enable row level security;
    grant select on media_objects to authenticated;
    create policy store_member_select on media_objects for select to authenticated
      using (store_id = '${storeId}'::uuid);
    -- Simulate existing Supabase default grants; the migration must revoke these.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant select on tables to public;
  `);
  await db.exec(readFileSync("drizzle/0121_media_file_metadata.sql", "utf8"));
  return db;
}

async function save(db: PGlite, metadata: MediaFileMetadata, coordinates = { storeId, mediaId }) {
  const { sql, params } = new PgDialect().sqlToQuery(buildSaveMediaMetadataQuery({ ...coordinates, metadata }));
  return (await db.query(sql, params)).rows;
}

test("metadata migration preserves originals and rejects malformed, cross-tenant or unbounded JSON", async () => {
  const db = await fixture();
  try {
    const before = (await db.query("select * from media_objects")).rows;
    expect(Object.keys(before[0] as object)).not.toContain("file_metadata");
    await save(db, valid);
    expect((await db.query<{ metadata: unknown }>("select metadata from media_file_metadata")).rows[0].metadata).toEqual(valid);
    expect((await db.query("select * from media_objects")).rows).toEqual(before);
    for (const invalid of [{}, [], { ...valid, version: null }, { ...valid, version: "1" }, { ...valid, version: 2 }, { ...valid, status: "invented" }, { ...valid, extractedAt: null }, { ...valid, blob: "x".repeat(17000) }]) {
      await expect(db.query("update media_file_metadata set metadata=$1::jsonb", [JSON.stringify(invalid)])).rejects.toMatchObject({ code: "23514" });
    }
    await expect(db.query("insert into media_file_metadata values ($1,$2,$3::jsonb)", [otherStoreId, mediaId, JSON.stringify(valid)])).rejects.toMatchObject({ code: "23503" });
  } finally { await db.close(); }
});

test("authenticated store members retain registry access but cannot bypass target authorization to read GPS", async () => {
  const db = await fixture();
  try {
    await save(db, valid);
    const [flags] = (await db.query<{ enabled: boolean; policies: number }>(`
      select relrowsecurity as enabled,
        (select count(*)::int from pg_policies where tablename='media_file_metadata') as policies
      from pg_class where relname='media_file_metadata'
    `)).rows;
    expect(flags).toEqual({ enabled: true, policies: 0 });
    for (const role of ["authenticated", "anon"]) {
      await db.exec(`set role ${role}`);
      if (role === "authenticated") {
        expect((await db.query("select object_key from media_objects")).rows).toEqual([{ object_key: "unchanged/original.jpg" }]);
      }
      await expect(db.query("select metadata from media_file_metadata")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("update media_file_metadata set metadata='{}'::jsonb")).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");
    }
    // Defense in depth: even an accidental later grant has no matching RLS policy.
    await db.exec("grant select on media_file_metadata to authenticated; set role authenticated;");
    expect((await db.query("select metadata from media_file_metadata")).rows).toEqual([]);
  } finally { await db.close(); }
});

test("metadata save retries only missing or failed results; late failures never overwrite success", async () => {
  const db = await fixture();
  try {
    const failed: MediaFileMetadata = { version: 1, status: "failed", extractedAt: valid.extractedAt };
    expect(await save(db, failed)).toHaveLength(1);
    expect(await save(db, valid)).toHaveLength(1);
    expect(await save(db, failed)).toEqual([]);
    expect(await save(db, { ...valid, latitude: 50 })).toEqual([]);
    const selected = await drizzle(db).select({ id: mediaObjects.id, fileMetadata: mediaRecordWithMetadata.fileMetadata })
      .from(mediaObjects).where(eq(mediaObjects.id, mediaId));
    expect(selected).toEqual([{ id: mediaId, fileMetadata: valid }]);
  } finally { await db.close(); }
});

test("metadata writes require ready private supported media in the exact tenant", async () => {
  const db = await fixture();
  try {
    expect(await save(db, valid, { storeId: otherStoreId, mediaId })).toEqual([]);
    for (const condition of ["status='pending'", "status='deleted'", "visibility='public'", "purpose='product-image'", "purpose='ai-attachment'", "deleted_at=now()"] ) {
      await db.exec("update media_objects set status='ready', visibility='private', purpose='project-document', deleted_at=null");
      await db.exec(`update media_objects set ${condition}`);
      expect(await save(db, valid)).toEqual([]);
    }
    expect((await db.query("select * from media_file_metadata")).rows).toEqual([]);
    await db.exec("update media_objects set deleted_at=null");
    expect(await save(db, valid)).toHaveLength(1);
    await db.exec("delete from media_objects");
    expect((await db.query("select * from media_file_metadata")).rows).toEqual([]);
  } finally { await db.close(); }
});
