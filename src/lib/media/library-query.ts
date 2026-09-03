import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";

import { normalizeSearch } from "@/lib/normalize";
import type { MediaProvider } from "@/lib/media/types";
import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";

const cursorSchema = z.object({
  v: z.literal(1),
  createdAt: z.iso.datetime().max(32),
  id: canonicalUuidCoordinateSchema,
}).strict();
const querySchema = z.object({
  q: z.string().trim().max(200).default(""),
  album: z.string().trim().max(80).optional(),
  kind: z.enum(["image", "video", "document"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

export class MediaLibraryQueryError extends Error {
  constructor() {
    super("Invalid media library query");
    this.name = "MediaLibraryQueryError";
  }
}

export type MediaLibraryQuery = z.infer<typeof querySchema> & {
  cursor?: z.infer<typeof cursorSchema>;
};

export function parseMediaLibraryQuery(params: URLSearchParams): MediaLibraryQuery {
  for (const key of ["q", "album", "kind", "limit", "cursor"]) {
    if (params.getAll(key).length > 1) throw new MediaLibraryQueryError();
  }
  const parsed = querySchema.safeParse({
    q: params.get("q") ?? undefined,
    album: params.get("album") ?? undefined,
    kind: params.get("kind") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) throw new MediaLibraryQueryError();
  const query: MediaLibraryQuery = parsed.data;
  const cursor = params.get("cursor");
  if (cursor !== null) {
    if (!/^[A-Za-z0-9_-]{1,768}$/.test(cursor)) throw new MediaLibraryQueryError();
    try {
      const decoded = Buffer.from(cursor, "base64url");
      if (decoded.toString("base64url") !== cursor) throw new MediaLibraryQueryError();
      query.cursor = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    } catch {
      throw new MediaLibraryQueryError();
    }
  }
  return query;
}

export function encodeMediaLibraryCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: row.createdAt, id: row.id })).toString("base64url");
}

export type MediaLibraryStorageRow = {
  id: string;
  mediaId: string;
  album: string;
  title: string;
  note: string | null;
  tags: string[];
  createdAt: string;
  creatorName: string | null;
  provider: MediaProvider;
  bucket: string;
  objectKey: string;
  thumbnailObjectKey: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata?: MediaFileMetadata | null;
};

export type MediaLibraryOverviewRow = {
  totalItems: number;
  libraryObjects: number;
  libraryBytes: string;
  totalObjects: number;
  totalBytes: string;
  albums: Array<{ name: string; count: number }>;
};

// All read paths use this same tenant/ready-state boundary, including URL resolution.
function visibleSource(storeId: string): SQL {
  return sql`
    from media_library_items l
    inner join media_objects m on m.store_id = l.store_id and m.id = l.media_object_id
    left join profiles p on p.store_id = l.store_id and p.id = l.created_by
    where l.store_id = ${storeId}::uuid and l.deleted_at is null
      and m.status = 'ready' and m.purpose = 'library-asset' and m.target_id = ${storeId}::uuid
  `;
}

const rowColumns = sql`
  l.id, l.media_object_id as "mediaId", l.album, l.title, l.note, l.tags,
  to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
  p.full_name as "creatorName", m.provider, m.bucket, m.object_key as "objectKey",
  m.thumbnail_object_key as "thumbnailObjectKey", m.original_file_name as "fileName",
  m.mime_type as "mimeType", m.size_bytes::float8 as "sizeBytes",
  (select fm.metadata from media_file_metadata fm
    where fm.store_id = m.store_id and fm.media_object_id = m.id) as metadata
`;
const combiningMarks = Array.from({ length: 112 }, (_, index) => String.fromCharCode(0x300 + index)).join("");

function filters(query: MediaLibraryQuery, fields: {
  album: SQL; title: SQL; note: SQL; tags: SQL; fileName: SQL; mimeType: SQL;
}): SQL {
  const clauses: SQL[] = [sql`true`];
  if (query.album) clauses.push(sql`${fields.album} = ${query.album}`);
  if (query.kind === "image") clauses.push(sql`${fields.mimeType} like 'image/%'`);
  if (query.kind === "video") clauses.push(sql`${fields.mimeType} like 'video/%'`);
  if (query.kind === "document") clauses.push(sql`${fields.mimeType} not like 'image/%' and ${fields.mimeType} not like 'video/%'`);
  const normalizedQuery = normalizeSearch(query.q);
  if (normalizedQuery) {
    // Match the client search's Vietnamese accent folding, without requiring an extension.
    // strpos treats %, _ and backslashes as literal input instead of SQL wildcards.
    const haystack = sql`regexp_replace(lower(replace(replace(translate(normalize(concat_ws(' ',
      ${fields.title}, ${fields.fileName}, ${fields.album}, ${fields.note}, array_to_string(${fields.tags}, ' ')
    ), NFD), ${combiningMarks}, ''), 'đ', 'd'), 'Đ', 'D')), '[[:space:]]+', ' ', 'g')`;
    clauses.push(sql`strpos(${haystack}, ${normalizedQuery}) > 0`);
  }
  return sql.join(clauses, sql` and `);
}

const sourceFields = {
  album: sql`l.album`, title: sql`l.title`, note: sql`l.note`, tags: sql`l.tags`,
  fileName: sql`m.original_file_name`, mimeType: sql`m.mime_type`,
};

export function buildMediaLibraryPageQuery(storeId: string, query: MediaLibraryQuery): SQL {
  const after = query.cursor
    ? sql`and (l.created_at, l.id) < (${query.cursor.createdAt}::timestamptz, ${query.cursor.id}::uuid)`
    : sql``;
  return sql`select ${rowColumns} ${visibleSource(storeId)}
    and ${filters(query, sourceFields)} ${after}
    order by l.created_at desc, l.id desc limit ${query.limit + 1}`;
}

export function buildMediaLibraryOverviewQuery(storeId: string, query: MediaLibraryQuery): SQL {
  return sql`
    with visible as materialized (
      select l.album, l.title, l.note, l.tags, m.original_file_name as "fileName", m.mime_type as "mimeType",
        m.size_bytes + coalesce(m.thumbnail_size_bytes, 0) as bytes
      ${visibleSource(storeId)}
    )
    select count(*)::int as "libraryObjects", coalesce(sum(v.bytes), 0)::text as "libraryBytes",
      count(*) filter (where ${filters(query, {
        album: sql`v.album`, title: sql`v.title`, note: sql`v.note`, tags: sql`v.tags`,
        fileName: sql`v."fileName"`, mimeType: sql`v."mimeType"`,
      })})::int as "totalItems",
      (select count(*)::int from media_objects where store_id = ${storeId}::uuid and status = 'ready') as "totalObjects",
      (select coalesce(sum(size_bytes + coalesce(thumbnail_size_bytes, 0)), 0)::text from media_objects
        where store_id = ${storeId}::uuid and status = 'ready') as "totalBytes",
      (select coalesce(jsonb_agg(jsonb_build_object('name', a.album, 'count', a.count)), '[]'::jsonb)
        from (select album, count(*)::int as count from visible group by album) a) as albums
    from visible v
  `;
}

export function buildMediaLibraryResolveQuery(storeId: string, itemId: string): SQL {
  return sql`select ${rowColumns} ${visibleSource(storeId)} and l.id = ${itemId}::uuid limit 1`;
}
