import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  buildMediaLibraryOverviewQuery,
  buildMediaLibraryPageQuery,
  buildMediaLibraryResolveQuery,
  encodeMediaLibraryCursor,
  parseMediaLibraryQuery,
  type MediaLibraryStorageRow,
} from "../src/lib/media/library-query";
import { NEW_STORE_FEATURE_DEFAULTS } from "../src/lib/tenancy/store-features";

const storeId = "11111111-1111-4111-8111-111111111111";
const otherStoreId = "22222222-2222-4222-8222-222222222222";
const idFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const database = new PGlite();
const dialect = new PgDialect();
const signatures: { bucket: string; key: string; expiresInSeconds: number }[] = [];
mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: { execute: async (query: SQL) => ({ rows: await execute(query) }) } }));
mock.module("@/lib/media/storage", () => ({
  getObjectStorage: () => ({
    createDownloadUrl: async (input: { bucket: string; key: string; expiresInSeconds: number }) => {
      signatures.push(input);
      return `https://private.luma.test/${input.key}?signature=${signatures.length}`;
    },
  }),
}));
const { getMediaLibrarySnapshot, resolveMediaLibraryItem } = await import("../src/lib/media/library");
const actor = { storeId, userId: idFor(3000), role: "manager" as const, features: NEW_STORE_FEATURE_DEFAULTS };

async function execute<Row>(query: SQL): Promise<Row[]> {
  const { sql, params } = dialect.sqlToQuery(query);
  return (await database.query<Row>(sql, params)).rows;
}

beforeAll(async () => {
  await database.exec(`
    create table profiles (id uuid primary key, store_id uuid, full_name text);
    create table media_objects (
      id uuid primary key, store_id uuid, target_id uuid, provider text default 'r2',
      bucket text default 'private', object_key text, thumbnail_object_key text,
      original_file_name text, mime_type text, size_bytes bigint default 1024,
      thumbnail_size_bytes bigint, status text default 'ready', purpose text default 'library-asset'
    );
    create table media_library_items (
      id uuid primary key, store_id uuid, media_object_id uuid, album text, title text,
      note text, tags text[] default '{}', created_at timestamptz,
      created_by uuid, deleted_at timestamptz
    );
    insert into media_objects (id, store_id, target_id, object_key, original_file_name, mime_type)
    select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      '${storeId}', '${storeId}', 'library/' || n, n || '.jpg', 'image/jpeg'
    from generate_series(1,1205) n;
    insert into media_library_items (id,store_id,media_object_id,album,title,tags,created_at)
    select id,store_id,id,case when object_key='library/1' then 'Album cũ' else 'Đèn trang trí' end,
      case when object_key='library/1' then 'Vòi chậu EL-005' else 'Đèn thả' end,
      case when object_key='library/1' then array['mẫu 100%_đẹp'] else array['phòng khách'] end,
      '2026-09-01 10:00:00+00'::timestamptz + ((substring(object_key from 9)::int / 3) * interval '1 microsecond')
    from media_objects;
    insert into media_objects (id,store_id,target_id,object_key,original_file_name,mime_type)
    values ('${idFor(2001)}','${otherStoreId}','${otherStoreId}','other/private','private.pdf','application/pdf'),
      ('${idFor(2002)}','${storeId}','${storeId}','old/video','old.mp4','video/mp4'),
      ('${idFor(2003)}','${storeId}','${storeId}','old/doc','old.pdf','application/pdf');
    insert into media_library_items (id,store_id,media_object_id,album,title,created_at)
    select id,store_id,id,'Tài liệu cũ',original_file_name,'2020-01-01' from media_objects where id in
      ('${idFor(2001)}','${idFor(2002)}','${idFor(2003)}');
  `);
});

afterAll(() => database.close());

describe("media library query boundaries", () => {
  test("defaults to 60 and rejects malformed bounds, kinds and cursors", () => {
    expect(parseMediaLibraryQuery(new URLSearchParams()).limit).toBe(60);
    for (const value of ["limit=0", "limit=101", "limit=1.5", "kind=audio", "cursor=broken", "limit=10&limit=20", `q=${"x".repeat(201)}`, `album=${"x".repeat(81)}`]) {
      expect(() => parseMediaLibraryQuery(new URLSearchParams(value))).toThrow();
    }
    const invalid = Buffer.from(JSON.stringify({ v: 1, createdAt: "not-a-date", id: idFor(1) })).toString("base64url");
    expect(() => parseMediaLibraryQuery(new URLSearchParams({ cursor: invalid }))).toThrow();
  });

  test("walks more than 1,000 records without truncation, duplicate timestamps or microsecond loss", async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 30; page += 1) {
      const query = parseMediaLibraryQuery(new URLSearchParams({ limit: "60", ...(cursor ? { cursor } : {}) }));
      const rows = await execute<MediaLibraryStorageRow>(buildMediaLibraryPageQuery(storeId, query));
      const visible = rows.slice(0, query.limit);
      ids.push(...visible.map((row) => row.id));
      if (rows.length <= query.limit) break;
      cursor = encodeMediaLibraryCursor(visible.at(-1)!);
    }
    expect(ids.length).toBe(1207);
    expect(new Set(ids).size).toBe(1207);
    expect(ids).toContain(idFor(1));
    expect(ids).toContain(idFor(2003));
    expect(ids).not.toContain(idFor(2001));
  });

  test("filters before pagination and treats SQL wildcard characters literally", async () => {
    for (const q of ["voi chau", "100%_dep"]) {
      const rows = await execute<MediaLibraryStorageRow>(buildMediaLibraryPageQuery(storeId, parseMediaLibraryQuery(new URLSearchParams({ q }))));
      expect(rows.map((row) => row.id)).toEqual([idFor(1)]);
    }
    const documents = await execute<MediaLibraryStorageRow>(buildMediaLibraryPageQuery(storeId, parseMediaLibraryQuery(new URLSearchParams({ kind: "document" }))));
    expect(documents.map((row) => row.id)).toEqual([idFor(2003)]);
  });

  test("overview includes older albums and separates filtered counts from store usage", async () => {
    const [overview] = await execute<{ totalItems: number; libraryObjects: number; totalObjects: number; albums: {name: string; count: number}[] }>(
      buildMediaLibraryOverviewQuery(storeId, parseMediaLibraryQuery(new URLSearchParams({ kind: "video" }))),
    );
    expect(overview.totalItems).toBe(1);
    expect(overview.libraryObjects).toBe(1207);
    expect(overview.totalObjects).toBe(1207);
    expect(overview.albums).toContainEqual({ name: "Album cũ", count: 1 });
    expect(overview.albums).toContainEqual({ name: "Tài liệu cũ", count: 2 });
  });

  test("snapshot exposes the page boundary and signs only the visible page", async () => {
    signatures.length = 0;
    const first = await getMediaLibrarySnapshot(actor);
    expect(first.items.length).toBe(60);
    expect(signatures.length).toBe(60);
    expect(first.page).toMatchObject({ hasMore: true, totalItems: 1207 });
    expect(first.page?.nextCursor).toBeString();
    const next = await getMediaLibrarySnapshot(actor, parseMediaLibraryQuery(new URLSearchParams({ cursor: first.page!.nextCursor! })));
    expect(next.items.length).toBe(60);
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(120);
    const filtered = await getMediaLibrarySnapshot(actor, parseMediaLibraryQuery(new URLSearchParams({ q: "voi chau" })));
    expect(filtered.items.map((item) => item.id)).toEqual([idFor(1)]);
    expect(filtered.page).toEqual({ hasMore: false, nextCursor: null, totalItems: 1 });
  });

  test("each resolution renews private URLs and missing/foreign items never reach the signer", async () => {
    signatures.length = 0;
    const first = await resolveMediaLibraryItem(actor, idFor(1));
    const second = await resolveMediaLibraryItem(actor, idFor(1));
    expect(first.url).not.toBe(second.url);
    expect(signatures).toEqual([
      { bucket: "private", key: "library/1", expiresInSeconds: 900 },
      { bucket: "private", key: "library/1", expiresInSeconds: 900 },
    ]);
    await expect(resolveMediaLibraryItem(actor, idFor(2001))).rejects.toMatchObject({ status: 404 });
    await expect(resolveMediaLibraryItem(actor, "invalid-coordinate")).rejects.toMatchObject({ status: 404 });
    expect(signatures.length).toBe(2);
    expect(Object.keys(first)).not.toContain("objectKey");
    expect(Object.keys(first)).not.toContain("bucket");
  });

  test("resolver never returns another store, deleted or pending media", async () => {
    expect(await execute(buildMediaLibraryResolveQuery(storeId, idFor(2001)))).toEqual([]);
    expect((await execute<MediaLibraryStorageRow>(buildMediaLibraryResolveQuery(storeId, idFor(1))))[0]?.objectKey).toBe("library/1");
    await database.exec(`update media_library_items set deleted_at=now() where id='${idFor(2)}'; update media_objects set status='pending' where id='${idFor(3)}'`);
    expect(await execute(buildMediaLibraryResolveQuery(storeId, idFor(2)))).toEqual([]);
    expect(await execute(buildMediaLibraryResolveQuery(storeId, idFor(3)))).toEqual([]);
  });
});
