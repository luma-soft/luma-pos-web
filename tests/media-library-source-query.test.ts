import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  buildMediaLibraryPageQuery, buildMediaLibraryOverviewQuery, buildMediaLibraryResolveQuery,
  encodeMediaLibraryCursor, parseMediaLibraryQuery, type MediaLibraryStorageRow, type MediaLibraryOverviewRow,
} from "../src/lib/media/library-query";
import type { MediaLibrarySourceContext } from "../src/lib/media/library-source-query";
import { CURRENT_STORE_FEATURE_DEFAULTS } from "../src/lib/tenancy/store-features";
import { mediaLibraryKindForMime } from "../src/lib/media/library-schema";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const storeId = id(1), otherStore = id(2), userId = id(3);
const publicMedia = { publicBucket: "public-media", publicBaseUrl: "https://media.luma.test" };
const context = (role: MediaLibrarySourceContext["actor"]["role"] = "owner", enabled = true): MediaLibrarySourceContext => ({
  actor: { storeId, userId, role, features: { ...CURRENT_STORE_FEATURE_DEFAULTS, field_services: enabled } }, publicMedia,
});
const database = new PGlite();
const dialect = new PgDialect();
async function execute<T>(query: SQL): Promise<T[]> {
  const value = dialect.sqlToQuery(query);
  return (await database.query<T>(value.sql, value.params)).rows;
}
const query = (params: Record<string, string> = {}) => parseMediaLibraryQuery(new URLSearchParams({ includeSources: "1", ...params }));
const page = (ctx = context(), params: Record<string, string> = {}) => execute<MediaLibraryStorageRow>(buildMediaLibraryPageQuery(storeId, query(params), ctx));
const overview = async (ctx = context(), params: Record<string, string> = {}) => (await execute<MediaLibraryOverviewRow>(buildMediaLibraryOverviewQuery(storeId, query(params), ctx)))[0];
const resolve = (key: string, ctx = context()) => execute<MediaLibraryStorageRow>(buildMediaLibraryResolveQuery(storeId, key, ctx));

beforeAll(async () => {
  await database.exec(`
    create table profiles(id uuid primary key,store_id uuid,full_name text);
    create table media_objects(id uuid primary key,store_id uuid,target_id uuid,provider text default 'r2',visibility text default 'private',
      purpose text default 'project-document',domain text default 'projects',bucket text default 'private-media',object_key text,
      thumbnail_object_key text,original_file_name text default 'original.jpg',mime_type text default 'image/jpeg',size_bytes bigint default 100,
      thumbnail_size_bytes bigint,status text default 'ready',created_at timestamptz default '2026-09-01T00:00:00Z',deleted_at timestamptz);
    create table media_file_metadata(store_id uuid,media_object_id uuid,metadata jsonb,primary key(store_id,media_object_id));
    create table media_library_items(id uuid primary key,store_id uuid,media_object_id uuid,album text,title text,note text,
      tags text[] default '{}',created_at timestamptz default '2026-09-01T00:00:00Z',created_by uuid,deleted_at timestamptz);
    create table products(id uuid primary key,store_id uuid,name text,sku text,image_urls jsonb default '[]',parent_product_id uuid,
      image_updated_at timestamptz default '2026-09-01T00:00:00Z');
    create table product_media(id uuid primary key,store_id uuid,product_id uuid,media_object_id uuid,deleted_at timestamptz,
      created_at timestamptz default '2026-09-01T00:00:00Z');
    create table projects(id uuid primary key,store_id uuid,name text,service_type text);
    create table service_jobs(id uuid primary key,store_id uuid,project_id uuid,title text,service_type text,assigned_to uuid);
    create table service_job_assignments(id uuid primary key,store_id uuid,job_id uuid,profile_id uuid,removed_at timestamptz);
    create table installed_assets(id uuid primary key,store_id uuid,project_id uuid,job_id uuid,name text);
    create table service_attachments(id uuid primary key,store_id uuid,project_id uuid,job_id uuid,asset_id uuid,claim_id uuid,request_id uuid,
      media_object_id uuid,project_phase text,category text default 'before',bucket text default 'private-media',path text,
      file_name text default 'site.jpg',mime_type text default 'image/jpeg',size_bytes bigint default 100,caption text,created_by uuid,
      created_at timestamptz default '2026-09-01T00:00:00Z',deleted_at timestamptz,storage_deleted_at timestamptz);
    insert into media_objects(id,store_id,target_id,purpose,domain,object_key) values ('${id(10)}','${storeId}','${storeId}','library-asset','library','manual');
    insert into media_library_items(id,store_id,media_object_id,album,title) values ('${id(11)}','${storeId}','${id(10)}','Hàng hóa','Manual faucet');
    insert into products(id,store_id,name,sku) values ('${id(20)}','${storeId}','Vòi chậu EL-005','EL005'),('${id(21)}','${storeId}','Variant','CHILD');
    update products set parent_product_id='${id(20)}' where id='${id(21)}';
    insert into media_objects(id,store_id,target_id,purpose,domain,visibility,bucket,object_key) values
      ('${id(30)}','${storeId}','${id(20)}','product-image','products','public','public-media','stores/${storeId}/products/2026/09/${id(30)}/original.jpg');
    insert into product_media(id,store_id,product_id,media_object_id) values ('${id(31)}','${storeId}','${id(20)}','${id(30)}');
    insert into projects values ('${id(100)}','${storeId}','Camera site','camera'),('${id(101)}','${storeId}','Mixed site','mixed');
    insert into service_jobs values
      ('${id(200)}','${storeId}','${id(100)}','Assigned camera','camera','${userId}'),
      ('${id(201)}','${storeId}','${id(100)}','Other electrical','electrical','${id(4)}'),
      ('${id(202)}','${storeId}','${id(101)}','Crew plumbing','plumbing',null),
      ('${id(203)}','${storeId}','${id(101)}','Removed camera','camera',null);
    insert into service_job_assignments values ('${id(210)}','${storeId}','${id(202)}','${userId}',null),
      ('${id(211)}','${storeId}','${id(203)}','${userId}',now()),
      ('${id(212)}','${otherStore}','${id(201)}','${userId}',null);
    insert into installed_assets values ('${id(300)}','${storeId}','${id(100)}','${id(201)}','Electrical cabinet');
  `);
  await database.query("update products set image_urls=$1::jsonb where id=$2", [JSON.stringify([
    "https://images.test/old.jpg", "https://images.test/old.jpg", `${publicMedia.publicBaseUrl}/stores/${storeId}/products/2026/09/${id(30)}/original.jpg`,
    "javascript:alert(1)", "https://user:secret@images.test/a.jpg", "https://[broken/x", "https://images.test:99999/x", "HTTPS://images.test:99999/x",
    "https://media.luma.test:443/invalid.jpg", "https://media.luma.test?invalid.jpg", "https://999.999.999.999/x", "not a url", 5,
  ]), id(20)]);
  await database.query("update products set image_urls=$1::jsonb where id=$2", [JSON.stringify(["https://images.test/old.jpg"]), id(21)]);
  for (let n = 400; n <= 415; n++) {
    const job = n === 401 || n === 407 ? id(200) : n === 402 ? id(201) : n === 405 ? id(202) : n === 406 ? id(203) : null;
    const project = [404, 405, 406].includes(n) ? id(101) : id(100);
    const sourceStore = n === 412 ? otherStore : storeId;
    if (n !== 407) await database.query(`insert into media_objects(id,store_id,target_id,purpose,domain,object_key,status)
      values($1,$2,$3,$4,$5,$6,$7)`, [id(n+1000), n === 415 ? otherStore : sourceStore,
      n === 413 ? id(999) : job ?? project, job ? "service-evidence" : "project-document", job ? "service-evidence" : "projects", `source/${n}`, n === 414 ? "pending" : "ready"]);
    await database.query(`insert into service_attachments(id,store_id,project_id,job_id,asset_id,media_object_id,path,category,claim_id,request_id,deleted_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id(n), sourceStore, project, job, n === 403 ? id(300) : null,
      n === 407 ? null : id(n+1000), `source/${n}`, n === 408 ? "signature" : n === 403 ? "asset" : "before",
      n === 409 ? id(900) : null, n === 410 ? id(901) : null, n === 411 ? new Date() : null]);
  }
});
afterAll(() => database.close());

describe("virtual library source albums", () => {
  test("requires opt-in, discriminates manual album names and rejects mixed selectors", () => {
    expect(parseMediaLibraryQuery(new URLSearchParams()).includeSources).toBe(false);
    for (const input of ["source=products", "includeSources=0", "includeSources=1&source=unknown", "includeSources=1&source=products&album=Hàng+hóa", "includeSources=1&includeSources=1"]) {
      expect(() => parseMediaLibraryQuery(new URLSearchParams(input))).toThrow();
    }
    expect(() => buildMediaLibraryPageQuery(storeId, query())).toThrow();
    expect(() => buildMediaLibraryPageQuery(otherStore, query(), context())).toThrow();
  });

  test("owner sees live source images only, deduplicates inherited product photos, preserves storage totals", async () => {
    const rows = await page();
    expect(rows).toHaveLength(11);
    expect(rows.filter((row) => row.id.startsWith("pm:"))).toHaveLength(1);
    const legacy = rows.filter((row) => row.id.startsWith("pu:"));
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ mediaId: "", mimeType: "image/*", sizeBytes: 0, sizeKnown: false, uploadedAt: null, directUrl: "https://images.test/old.jpg" });
    expect(rows.some((row) => row.id === `sa:${id(407)}` && row.provider === "supabase")).toBe(true);
    const stats = await overview();
    expect(stats.totalItems).toBe(11);
    expect(stats.libraryObjects).toBe(1);
    expect(stats.libraryBytes).toBe("100");
    const [original] = await execute<MediaLibraryOverviewRow>(buildMediaLibraryOverviewQuery(storeId, parseMediaLibraryQuery(new URLSearchParams())));
    expect(stats.totalObjects).toBe(original.totalObjects);
    expect(stats.totalBytes).toBe(original.totalBytes);
  });

  test("source filter never selects same-named manual album; exact job trade takes precedence", async () => {
    expect((await page(context(), { album: "Hàng hóa" })).map((row) => row.id)).toEqual([id(11)]);
    expect((await page(context(), { source: "products" })).map((row) => row.source?.type)).toEqual(["product", "product"]);
    expect((await page(context(), { source: "electrical" })).map((row) => row.id).sort()).toEqual([`sa:${id(402)}`, `sa:${id(403)}`]);
    expect((await page(context(), { source: "mixed" })).map((row) => row.id)).toEqual([`sa:${id(404)}`]);
    expect((await overview(context(), { source: "plumbing" })).totalItems).toBe(1);
    expect((await page(context(), { source: "products", q: "voi chau" })).length).toBe(2);
    expect((await overview(context(), { source: "products", q: "no matching label" })).totalItems).toBe(0);
  });

  test("cashiers read products, technicians read assigned construction only, managers respect feature gate", async () => {
    expect((await page(context("cashier"))).map((row) => row.source?.type ?? "manual").sort()).toEqual(["manual", "product", "product"]);
    const techIds = (await page(context("technician"))).map((row) => row.id);
    expect(techIds.sort()).toEqual([id(11), ...[400,401,404,405,407].map((n) => `sa:${id(n)}`)].sort());
    for (const n of [402,403,406]) expect(await resolve(`sa:${id(n)}`, context("technician"))).toEqual([]);
    expect(await resolve(`pm:${id(31)}`, context("technician"))).toEqual([]);
    expect((await overview(context("manager", false))).albums.filter((album) => album.system).map((album) => album.source)).toEqual(["products"]);
    expect((await overview(context("technician", false))).albums.filter((album) => album.system)).toEqual([]);
    const presets = (await overview(context("technician"))).albums.filter((album) => album.system);
    expect(presets).toHaveLength(4);
    expect(presets.find((album) => album.source === "electrical")?.count).toBe(0);
  });

  test("keyset pagination across source prefixes and equal timestamps neither loses nor duplicates items", async () => {
    const expected = (await page()).map((row) => row.id);
    const found: string[] = [];
    let cursor: string | undefined;
    for (let n=0;n<10;n++) {
      const rows = await page(context(), { limit: "2", ...(cursor ? { cursor } : {}) });
      found.push(...rows.slice(0,2).map((row) => row.id));
      if (rows.length <= 2) break;
      cursor = encodeMediaLibraryCursor(rows[1]);
    }
    expect(found).toEqual(expected);
    expect(new Set(found).size).toBe(expected.length);
    expect(() => parseMediaLibraryQuery(new URLSearchParams({ cursor: encodeMediaLibraryCursor({ createdAt: "2026-09-01T00:00:00Z", id: `sa:${id(400)}` }) }))).toThrow();
  });

  test("resolve rechecks live source association and assignment revocation", async () => {
    expect(await resolve(`sa:${id(401)}`, context("technician"))).toHaveLength(1);
    await database.query("update service_jobs set assigned_to=null where id=$1", [id(200)]);
    expect(await resolve(`sa:${id(401)}`, context("technician"))).toEqual([]);
    await database.query("update service_jobs set assigned_to=$1 where id=$2", [userId,id(200)]);
    await database.query("update product_media set deleted_at=now() where id=$1", [id(31)]);
    expect(await resolve(`pm:${id(31)}`)).toEqual([]);
    await database.query("update product_media set deleted_at=null where id=$1", [id(31)]);
    await database.query("update service_attachments set deleted_at=now() where id=$1", [id(400)]);
    expect(await resolve(`sa:${id(400)}`)).toEqual([]);
    await database.query("update service_attachments set deleted_at=null where id=$1", [id(400)]);
  });

  test("one unsupported legacy image or malformed URL cannot make a page unrenderable", async () => {
    for (const mime of ["image/bmp", "image/svg+xml", "image/not-real"]) {
      await database.query("update service_attachments set mime_type=$1 where id=$2", [mime,id(407)]);
      expect(await resolve(`sa:${id(407)}`)).toEqual([]);
      const rows = await page();
      for (const row of rows) {
        if (row.mimeType === "image/*") expect(row).toMatchObject({ source: { type: "product" }, mediaId: "", sizeKnown: false });
        else expect(mediaLibraryKindForMime(row.mimeType)).toBe("image");
        if (row.directUrl) expect(() => new URL(row.directUrl!)).not.toThrow();
      }
    }
    await database.query("update service_attachments set mime_type='image/jpeg' where id=$1", [id(407)]);
  });

  test("future product associations appear automatically without creating or copying library records", async () => {
    await database.query(`insert into media_objects(id,store_id,target_id,purpose,domain,visibility,bucket,object_key)
      values($1,$2,$3,'product-image','products','public','public-media',$4)`,
      [id(602),storeId,id(20),`stores/${storeId}/products/2026/09/${id(602)}/original.jpg`]);
    await database.query("insert into product_media(id,store_id,product_id,media_object_id) values($1,$2,$3,$4)", [id(601),storeId,id(20),id(602)]);
    const result = await page(context(), { source: "products" });
    expect(result.some((row) => row.id === `pm:${id(601)}` && row.mediaId === id(602))).toBe(true);
    expect((await overview()).libraryObjects).toBe(1);
    expect((await database.query<{ count: number }>("select count(*)::int as count from media_library_items")).rows[0].count).toBe(1);
    expect(await resolve(`pm:${id(601)}`)).toHaveLength(1);
    await database.query("delete from product_media where id=$1", [id(601)]);
    await database.query("delete from media_objects where id=$1", [id(602)]);
  });
});
