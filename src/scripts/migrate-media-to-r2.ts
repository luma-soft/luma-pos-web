import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

import { getR2Config } from "@/lib/media/config";
import {
  classifyLegacyUrl,
  createMediaMigrationEngine,
  type MediaMigrationInventoryInput,
  type MediaMigrationItem,
  type MediaMigrationReference,
  type MediaMigrationRepository,
  type MediaMigrationStatus,
} from "@/lib/media/migration";
import { getObjectStorage } from "@/lib/media/storage";

const COMMANDS = new Set([
  "inventory",
  "copy",
  "verify",
  "cutover",
  "rollback",
  "delete-source",
] as const);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BUCKETS = new Set([
  "products",
  "service-evidence",
  "service-customer-request-evidence",
  "ai-attachments",
  "ai-pos-attachments",
  "luma-ai-attachments",
]);

type Command = "inventory" | "copy" | "verify" | "cutover" | "rollback" | "delete-source";
type Database = ReturnType<typeof postgres>;
type MigrationRow = Record<string, unknown>;

type DiscoveredReference = {
  runId: string;
  storeId: string;
  purpose: MediaMigrationItem["purpose"];
  targetId: string;
  domain: string;
  visibility: "public" | "private";
  originalFileName: string;
  mimeType: string;
  reference: MediaMigrationReference;
  url?: string;
  bucket?: string;
  key?: string;
};

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integerArgument(name: string, fallback: number) {
  const raw = argument(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function requireUuid(name: string, value: string | undefined) {
  if (!value || !UUID_PATTERN.test(value)) throw new Error(`${name}_uuid_required`);
  return value.toLowerCase();
}

function optionalStoreId() {
  const value = argument("store-id");
  if (!value) return null;
  return requireUuid("store_id", value);
}

function allowedHosts() {
  const hosts = new Set<string>();
  for (const value of [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
  ]) {
    if (!value) continue;
    try {
      hosts.add(new URL(value).hostname.toLowerCase());
    } catch {
      throw new Error("invalid_supabase_url");
    }
  }
  return hosts;
}

function allowedBuckets() {
  const buckets = new Set(DEFAULT_BUCKETS);
  for (const value of (process.env.LUMA_LEGACY_MEDIA_BUCKETS ?? "").split(",")) {
    const bucket = value.trim();
    if (bucket) buckets.add(bucket);
  }
  return buckets;
}

function fileNameFromValue(value: string, fallback: string) {
  try {
    const url = new URL(value);
    const segment = url.pathname.split("/").filter(Boolean).at(-1);
    return segment ? decodeURIComponent(segment).slice(0, 240) : fallback;
  } catch {
    return fallback;
  }
}

function mimeFromFileName(fileName: string) {
  const extension = fileName.toLowerCase().split(".").at(-1);
  return ({
    avif: "image/avif",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    webp: "image/webp",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function externalCoordinate(value: string) {
  let host = "invalid-url";
  try {
    host = new URL(value).hostname.toLowerCase() || host;
  } catch {}
  return {
    sourceBucket: `external:${host}`,
    sourceKey: createHash("sha256").update(value).digest("hex"),
  };
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowToItem(row: MigrationRow): MediaMigrationItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    storeId: String(row.store_id),
    sourceProvider: row.source_provider as MediaMigrationItem["sourceProvider"],
    sourceBucket: String(row.source_bucket),
    sourceKey: String(row.source_key),
    targetBucket: row.target_bucket == null ? null : String(row.target_bucket),
    targetKey: row.target_key == null ? null : String(row.target_key),
    mediaObjectId: row.media_object_id == null ? null : String(row.media_object_id),
    status: row.status as MediaMigrationStatus,
    purpose: row.purpose as MediaMigrationItem["purpose"],
    targetId: row.target_id == null ? "" : String(row.target_id),
    domain: String(row.domain),
    visibility: row.visibility as "public" | "private",
    originalFileName: String(row.original_file_name),
    mimeType: String(row.mime_type),
    references: Array.isArray(row.reference_documents)
      ? row.reference_documents as MediaMigrationReference[]
      : [],
    sourceSizeBytes: numberOrNull(row.source_size_bytes),
    sourceSha256: row.source_sha256 == null ? null : String(row.source_sha256),
    targetSizeBytes: numberOrNull(row.target_size_bytes),
    targetSha256: row.target_sha256 == null ? null : String(row.target_sha256),
    attempts: Number(row.attempts ?? 0),
    verifiedAt: dateOrNull(row.verified_at),
    cutoverAt: dateOrNull(row.cutover_at),
    sourceDeletedAt: dateOrNull(row.source_deleted_at),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

class PostgresMigrationRepository implements MediaMigrationRepository {
  constructor(private readonly sql: Database) {}

  async ensureRun(input: { runId: string; storeId: string }) {
    const [row] = await this.sql<{ id: string; store_id: string }[]>`
      insert into media_migration_runs (id, store_id, status, started_at)
      values (${input.runId}::uuid, ${input.storeId}::uuid, 'running', now())
      on conflict (id) do update
      set status = case
        when media_migration_runs.status in ('pending', 'running', 'failed') then 'running'
        else media_migration_runs.status
      end,
      started_at = coalesce(media_migration_runs.started_at, now())
      returning id::text, store_id::text
    `;
    if (!row || row.store_id !== input.storeId) throw new Error("run_store_mismatch");
  }

  async requireRun(runId: string) {
    const [row] = await this.sql<{ id: string; store_id: string; status: string }[]>`
      select id::text, store_id::text, status
      from media_migration_runs where id = ${runId}::uuid
    `;
    if (!row) throw new Error("migration_run_not_found");
    return row;
  }

  async upsertInventoried(input: MediaMigrationItem) {
    const [row] = await this.sql<MigrationRow[]>`
      insert into media_migration_items (
        id, store_id, run_id, source_provider, source_bucket, source_key,
        target_bucket, target_key, status, purpose, target_id, domain, visibility,
        original_file_name, mime_type, reference_documents,
        attempts, last_error, updated_at
      ) values (
        ${input.id}::uuid, ${input.storeId}::uuid, ${input.runId}::uuid,
        ${input.sourceProvider}, ${input.sourceBucket}, ${input.sourceKey},
        ${input.targetBucket}, ${input.targetKey}, ${input.status},
        ${input.purpose}, ${input.targetId}::uuid, ${input.domain},
        ${input.visibility}, ${input.originalFileName},
        ${input.mimeType}, ${this.sql.json(input.references)},
        ${input.attempts}, ${input.lastError}, now()
      )
      on conflict (run_id, source_provider, source_bucket, source_key)
      do update set
        reference_documents = case
          when media_migration_items.purpose = excluded.purpose
            and media_migration_items.target_id = excluded.target_id
            and media_migration_items.domain = excluded.domain
            and media_migration_items.visibility = excluded.visibility
          then (
            select coalesce(jsonb_agg(value), '[]'::jsonb)
            from (
              select distinct value
              from jsonb_array_elements(
                media_migration_items.reference_documents
                || excluded.reference_documents
              )
            ) merged_references
          )
          else media_migration_items.reference_documents
        end,
        status = case
          when (
            media_migration_items.purpose <> excluded.purpose
            or media_migration_items.target_id <> excluded.target_id
            or media_migration_items.domain <> excluded.domain
            or media_migration_items.visibility <> excluded.visibility
          ) and media_migration_items.status in (
            'inventoried','copied','verified','failed'
          ) then 'quarantined'
          else media_migration_items.status
        end,
        last_error = case
          when media_migration_items.purpose <> excluded.purpose
            or media_migration_items.target_id <> excluded.target_id
            or media_migration_items.domain <> excluded.domain
            or media_migration_items.visibility <> excluded.visibility
          then 'reference_policy_conflict'
          else media_migration_items.last_error
        end,
        updated_at = now()
      returning *
    `;
    if (!row) throw new Error("migration_item_upsert_failed");
    return rowToItem(row);
  }

  async getItem(id: string) {
    const [row] = await this.sql<MigrationRow[]>`
      select * from media_migration_items where id = ${id}::uuid
    `;
    return row ? rowToItem(row) : null;
  }

  async listItems(
    runId: string,
    statuses: MediaMigrationStatus[],
    limit: number,
  ) {
    const rows = await this.sql<MigrationRow[]>`
      select *
      from media_migration_items
      where run_id = ${runId}::uuid
        and status in ${this.sql(statuses)}
      order by updated_at, id
      limit ${limit}
    `;
    return rows.map(rowToItem);
  }

  async transition(input: {
    id: string;
    from: MediaMigrationStatus[];
    to: MediaMigrationStatus;
    patch?: Partial<MediaMigrationItem>;
  }) {
    const current = await this.getItem(input.id);
    if (!current) throw new Error("migration_item_not_found");
    if (!input.from.includes(current.status)) return current;
    const next = { ...current, ...input.patch, status: input.to };
    const [row] = await this.sql<MigrationRow[]>`
      update media_migration_items
      set status = ${next.status},
          media_object_id = ${next.mediaObjectId}::uuid,
          mime_type = ${next.mimeType},
          source_size_bytes = ${next.sourceSizeBytes},
          source_sha256 = ${next.sourceSha256},
          target_size_bytes = ${next.targetSizeBytes},
          target_sha256 = ${next.targetSha256},
          attempts = ${next.attempts},
          verified_at = ${next.verifiedAt},
          cutover_at = ${next.cutoverAt},
          source_deleted_at = ${next.sourceDeletedAt},
          last_error = ${next.lastError},
          updated_at = now()
      where id = ${input.id}::uuid
        and status in ${this.sql(input.from)}
      returning *
    `;
    return row ? rowToItem(row) : (await this.getItem(input.id))!;
  }

  async cutoverItem(item: MediaMigrationItem) {
    return this.sql.begin(async (tx) => {
      const [lockedRow] = await tx<MigrationRow[]>`
        select * from media_migration_items
        where id = ${item.id}::uuid
        for update
      `;
      if (!lockedRow) throw new Error("migration_item_not_found");
      const locked = rowToItem(lockedRow);
      if (locked.status === "cutover" || locked.status === "source_deleted") return locked;
      if (locked.status !== "verified") throw new Error(`cutover_invalid_status:${locked.status}`);
      if (
        !locked.targetBucket
        || !locked.targetKey
        || !UUID_PATTERN.test(locked.targetId)
        || !locked.sourceSizeBytes
        || !locked.sourceSha256
      ) throw new Error("verified_coordinates_missing");

      await tx`
        insert into media_objects (
          id, store_id, provider, visibility, domain, bucket, object_key,
          original_file_name, mime_type, size_bytes, sha256, status,
          purpose, target_id, upload_expires_at,
          ready_at, verified_at, legacy_bucket, legacy_path
        ) values (
          ${locked.id}::uuid, ${locked.storeId}::uuid, 'r2',
          ${locked.visibility}, ${locked.domain}, ${locked.targetBucket},
          ${locked.targetKey}, ${locked.originalFileName}, ${locked.mimeType},
          ${locked.sourceSizeBytes}, ${locked.sourceSha256}, 'ready',
          ${locked.purpose}, ${locked.targetId}::uuid, now(),
          now(), now(), ${locked.sourceBucket}, ${locked.sourceKey}
        )
        on conflict (id) do nothing
      `;

      for (const reference of locked.references) {
        requireUuid("reference_record", reference.recordId);
        const sortOrder = Math.max(0, reference.index ?? 0);
        if (reference.kind === "product-image") {
          await tx`
            insert into product_media (
              store_id, product_id, media_object_id, sort_order, is_primary
            ) values (
              ${locked.storeId}::uuid, ${reference.recordId}::uuid,
              ${locked.id}::uuid, ${sortOrder}, ${sortOrder === 0}
            )
            on conflict (product_id, media_object_id) do update
            set deleted_at = null,
                sort_order = excluded.sort_order,
                is_primary = excluded.is_primary
          `;
        } else if (reference.kind === "brand-logo") {
          await tx`
            update brands set logo_media_object_id = ${locked.id}::uuid
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
          `;
        } else if (reference.kind === "service-attachment") {
          await tx`
            update service_attachments set media_object_id = ${locked.id}::uuid
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
          `;
        } else if (reference.kind === "customer-request-attachment") {
          await tx`
            update service_customer_request_attachments
            set media_object_id = ${locked.id}::uuid
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
          `;
        } else if (reference.kind === "handover-photo") {
          await tx`
            insert into service_handover_document_media (
              store_id, document_id, media_object_id, sort_order
            ) values (
              ${locked.storeId}::uuid, ${reference.recordId}::uuid,
              ${locked.id}::uuid, ${sortOrder}
            )
            on conflict (document_id, media_object_id) do update
            set sort_order = excluded.sort_order
          `;
        } else if (reference.kind === "ai-attachment") {
          await tx`
            update ai_chat_messages
            set attachments = (
              select jsonb_agg(
                case when ordinality - 1 = ${sortOrder}
                  then (attachment - 'signedUrl') || jsonb_build_object(
                    'mediaId', ${locked.id},
                    'bucket', ${locked.targetBucket},
                    'path', ${locked.targetKey}
                  )
                  else attachment
                end
                order by ordinality
              )
              from jsonb_array_elements(attachments) with ordinality
                as entries(attachment, ordinality)
            )
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
          `;
        }
      }

      const [updated] = await tx<MigrationRow[]>`
        update media_migration_items
        set media_object_id = ${locked.id}::uuid,
            status = 'cutover',
            cutover_at = now(),
            last_error = null,
            updated_at = now()
        where id = ${locked.id}::uuid and status = 'verified'
        returning *
      `;
      if (!updated) throw new Error("cutover_concurrent_transition");
      return rowToItem(updated);
    });
  }

  async rollbackItem(item: MediaMigrationItem) {
    return this.sql.begin(async (tx) => {
      const [lockedRow] = await tx<MigrationRow[]>`
        select * from media_migration_items
        where id = ${item.id}::uuid
        for update
      `;
      if (!lockedRow) throw new Error("migration_item_not_found");
      const locked = rowToItem(lockedRow);
      if (locked.status === "rolled_back") return locked;
      if (locked.status !== "cutover") throw new Error(`rollback_invalid_status:${locked.status}`);

      for (const reference of locked.references) {
        requireUuid("reference_record", reference.recordId);
        const sortOrder = Math.max(0, reference.index ?? 0);
        if (reference.kind === "product-image") {
          await tx`
            update product_media set deleted_at = now(), is_primary = false
            where store_id = ${locked.storeId}::uuid
              and product_id = ${reference.recordId}::uuid
              and media_object_id = ${locked.id}::uuid
          `;
        } else if (reference.kind === "brand-logo") {
          await tx`
            update brands set logo_media_object_id = null
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
              and logo_media_object_id = ${locked.id}::uuid
          `;
        } else if (reference.kind === "service-attachment") {
          await tx`
            update service_attachments set media_object_id = null
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
              and media_object_id = ${locked.id}::uuid
          `;
        } else if (reference.kind === "customer-request-attachment") {
          await tx`
            update service_customer_request_attachments
            set media_object_id = null
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
              and media_object_id = ${locked.id}::uuid
          `;
        } else if (reference.kind === "handover-photo") {
          await tx`
            delete from service_handover_document_media
            where store_id = ${locked.storeId}::uuid
              and document_id = ${reference.recordId}::uuid
              and media_object_id = ${locked.id}::uuid
          `;
        } else if (reference.kind === "ai-attachment") {
          await tx`
            update ai_chat_messages
            set attachments = (
              select jsonb_agg(
                case when ordinality - 1 = ${sortOrder}
                  then (attachment - 'mediaId' - 'signedUrl')
                    || jsonb_build_object(
                      'bucket', ${locked.sourceBucket},
                      'path', ${locked.sourceKey}
                    )
                  else attachment
                end
                order by ordinality
              )
              from jsonb_array_elements(attachments) with ordinality
                as entries(attachment, ordinality)
            )
            where store_id = ${locked.storeId}::uuid
              and id = ${reference.recordId}::uuid
          `;
        }
      }

      await tx`
        update media_objects
        set status = 'deleted', deleted_at = now()
        where store_id = ${locked.storeId}::uuid and id = ${locked.id}::uuid
      `;
      const [updated] = await tx<MigrationRow[]>`
        update media_migration_items
        set status = 'rolled_back', updated_at = now()
        where id = ${locked.id}::uuid and status = 'cutover'
        returning *
      `;
      if (!updated) throw new Error("rollback_concurrent_transition");
      return rowToItem(updated);
    });
  }

  async getSourceDeleteGate(runId: string) {
    const [row] = await this.sql<{
      completed_cutover_at: Date | null;
      unresolved_items: number;
      quarantined_items: number;
      fallback_reads: number;
    }[]>`
      select
        r.completed_at as completed_cutover_at,
        count(*) filter (
          where i.status not in ('cutover','source_deleted','skipped','rolled_back')
        )::int as unresolved_items,
        count(*) filter (where i.status = 'quarantined')::int as quarantined_items,
        coalesce(sum(i.fallback_read_count), 0)::int as fallback_reads
      from media_migration_runs r
      left join media_migration_items i on i.run_id = r.id
      where r.id = ${runId}::uuid
      group by r.completed_at
    `;
    if (!row) throw new Error("migration_run_not_found");
    return {
      completedCutoverAt: dateOrNull(row.completed_cutover_at),
      unresolvedItems: Number(row.unresolved_items),
      quarantinedItems: Number(row.quarantined_items),
      fallbackReads: Number(row.fallback_reads),
    };
  }

  async reconcileRun(runId: string, command: Command) {
    const [counts] = await this.sql<{
      total: number;
      unresolved: number;
      cutover: number;
      rolled_back: number;
      skipped: number;
      source_deleted: number;
    }[]>`
      select
        count(*)::int as total,
        count(*) filter (
          where status not in ('cutover','source_deleted','skipped','rolled_back')
        )::int as unresolved,
        count(*) filter (where status in ('cutover','source_deleted'))::int as cutover,
        count(*) filter (where status = 'rolled_back')::int as rolled_back,
        count(*) filter (where status = 'skipped')::int as skipped,
        count(*) filter (where status = 'source_deleted')::int as source_deleted
      from media_migration_items where run_id = ${runId}::uuid
    `;
    if (!counts) throw new Error("migration_run_not_found");
    if (
      command === "rollback"
      && counts.total > 0
      && counts.source_deleted === 0
      && counts.rolled_back + counts.skipped === counts.total
    ) {
      await this.sql`
        update media_migration_runs
        set status = 'rolled_back', completed_at = coalesce(completed_at, now())
        where id = ${runId}::uuid
      `;
    } else if (counts.total > 0 && counts.unresolved === 0 && counts.cutover > 0) {
      await this.sql`
        update media_migration_runs
        set status = 'completed', completed_at = coalesce(completed_at, now())
        where id = ${runId}::uuid
      `;
    }
    return counts;
  }
}

async function discoverLegacyReferences(
  sql: Database,
  runId: string,
  storeId: string | null,
): Promise<DiscoveredReference[]> {
  const discovered: DiscoveredReference[] = [];
  const productRows = await sql<{
    store_id: string;
    record_id: string;
    url: string;
    item_index: number;
  }[]>`
    select p.store_id::text, p.id::text as record_id,
      image.value as url, (image.ordinality - 1)::int as item_index
    from products p
    cross join lateral jsonb_array_elements_text(coalesce(p.image_urls, '[]'::jsonb))
      with ordinality as image(value, ordinality)
    where (${storeId}::uuid is null or p.store_id = ${storeId}::uuid)
      and not exists (
        select 1 from product_media managed
        where managed.store_id = p.store_id
          and managed.product_id = p.id
          and managed.deleted_at is null
      )
  `;
  for (const row of productRows) {
    const fileName = fileNameFromValue(row.url, "product-image");
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: "product-image",
      targetId: row.store_id,
      domain: "products",
      visibility: "public",
      originalFileName: fileName,
      mimeType: mimeFromFileName(fileName),
      reference: {
        kind: "product-image",
        recordId: row.record_id,
        index: row.item_index,
      },
      url: row.url,
    });
  }

  const brandRows = await sql<{
    store_id: string;
    record_id: string;
    url: string;
  }[]>`
    select store_id::text, id::text as record_id, logo_url as url
    from brands
    where logo_url is not null and logo_url <> ''
      and logo_media_object_id is null
      and (${storeId}::uuid is null or store_id = ${storeId}::uuid)
  `;
  for (const row of brandRows) {
    const fileName = fileNameFromValue(row.url, "brand-logo");
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: "product-image",
      targetId: row.store_id,
      domain: "products",
      visibility: "public",
      originalFileName: fileName,
      mimeType: mimeFromFileName(fileName),
      reference: { kind: "brand-logo", recordId: row.record_id },
      url: row.url,
    });
  }

  const serviceRows = await sql<{
    store_id: string;
    record_id: string;
    bucket: string;
    path: string;
    file_name: string;
    mime_type: string;
    project_id: string;
    job_id: string | null;
  }[]>`
    select store_id::text, id::text as record_id, bucket, path,
      file_name, mime_type, project_id::text, job_id::text
    from service_attachments
    where media_object_id is null
      and deleted_at is null
      and (${storeId}::uuid is null or store_id = ${storeId}::uuid)
  `;
  for (const row of serviceRows) {
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: row.job_id ? "service-evidence" : "project-document",
      targetId: row.job_id ?? row.project_id,
      domain: row.job_id ? "service-evidence" : "projects",
      visibility: "private",
      originalFileName: row.file_name,
      mimeType: row.mime_type,
      reference: { kind: "service-attachment", recordId: row.record_id },
      bucket: row.bucket,
      key: row.path,
    });
  }

  const customerRows = await sql<{
    store_id: string;
    record_id: string;
    bucket: string;
    path: string;
    file_name: string;
    mime_type: string;
    project_id: string;
  }[]>`
    select attachment.store_id::text, attachment.id::text as record_id,
      attachment.bucket, attachment.path, attachment.file_name,
      attachment.mime_type, request.project_id::text
    from service_customer_request_attachments attachment
    join service_customer_requests request on request.id = attachment.request_id
      and request.store_id = attachment.store_id
    where attachment.media_object_id is null
      and (${storeId}::uuid is null or attachment.store_id = ${storeId}::uuid)
  `;
  for (const row of customerRows) {
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: "project-document",
      targetId: row.project_id,
      domain: "projects",
      visibility: "private",
      originalFileName: row.file_name,
      mimeType: row.mime_type,
      reference: {
        kind: "customer-request-attachment",
        recordId: row.record_id,
      },
      bucket: row.bucket,
      key: row.path,
    });
  }

  const handoverRows = await sql<{
    store_id: string;
    record_id: string;
    url: string;
    item_index: number;
    project_id: string;
  }[]>`
    select document.store_id::text, document.id::text as record_id,
      photo.value as url, (photo.ordinality - 1)::int as item_index,
      document.project_id::text
    from service_handover_documents document
    cross join lateral jsonb_array_elements_text(document.photo_urls)
      with ordinality as photo(value, ordinality)
    where (${storeId}::uuid is null or document.store_id = ${storeId}::uuid)
      and not exists (
        select 1 from service_handover_document_media managed
        where managed.store_id = document.store_id
          and managed.document_id = document.id
      )
  `;
  for (const row of handoverRows) {
    const fileName = fileNameFromValue(row.url, "handover-photo");
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: "project-document",
      targetId: row.project_id,
      domain: "projects",
      visibility: "private",
      originalFileName: fileName,
      mimeType: mimeFromFileName(fileName),
      reference: {
        kind: "handover-photo",
        recordId: row.record_id,
        index: row.item_index,
      },
      url: row.url,
    });
  }

  const aiRows = await sql<{
    store_id: string;
    record_id: string;
    attachment: Record<string, unknown>;
    item_index: number;
    session_id: string;
  }[]>`
    select message.store_id::text, message.id::text as record_id,
      entry.attachment, (entry.ordinality - 1)::int as item_index,
      message.session_id::text
    from ai_chat_messages message
    cross join lateral jsonb_array_elements(coalesce(message.attachments, '[]'::jsonb))
      with ordinality as entry(attachment, ordinality)
    where entry.attachment->>'mediaId' is null
      and (${storeId}::uuid is null or message.store_id = ${storeId}::uuid)
  `;
  for (const row of aiRows) {
    const attachment = row.attachment ?? {};
    const bucket = typeof attachment.bucket === "string" ? attachment.bucket : undefined;
    const key = typeof attachment.path === "string"
      ? attachment.path
      : typeof attachment.id === "string"
        ? attachment.id
        : undefined;
    const url = typeof attachment.signedUrl === "string"
      ? attachment.signedUrl
      : undefined;
    if (!bucket && !key && !url) continue;
    discovered.push({
      runId,
      storeId: row.store_id,
      purpose: "ai-attachment",
      targetId: row.session_id,
      domain: "ai",
      visibility: "private",
      originalFileName: typeof attachment.name === "string"
        ? attachment.name
        : "ai-attachment",
      mimeType: typeof attachment.mimeType === "string"
        ? attachment.mimeType
        : "application/octet-stream",
      reference: {
        kind: "ai-attachment",
        recordId: row.record_id,
        index: row.item_index,
      },
      bucket,
      key,
      url,
    });
  }

  return discovered;
}

function classifyDiscovered(
  reference: DiscoveredReference,
  hosts: ReadonlySet<string>,
  buckets: ReadonlySet<string>,
) {
  if (reference.bucket && reference.key && buckets.has(reference.bucket)) {
    return {
      kind: "owned" as const,
      coordinates: {
        provider: "supabase" as const,
        bucket: reference.bucket,
        key: reference.key,
      },
    };
  }
  if (reference.url) {
    const coordinates = classifyLegacyUrl(reference.url, {
      allowedHosts: hosts,
      allowedBuckets: buckets,
    });
    if (coordinates) return { kind: "owned" as const, coordinates };
  }
  const identity = reference.url
    ?? `${reference.bucket ?? "unknown"}/${reference.key ?? "unknown"}`;
  return { kind: "external" as const, coordinates: externalCoordinate(identity) };
}

function summarize(
  discovered: DiscoveredReference[],
  hosts: ReadonlySet<string>,
  buckets: ReadonlySet<string>,
) {
  let owned = 0;
  let skipped = 0;
  const domains: Record<string, number> = {};
  for (const reference of discovered) {
    const classification = classifyDiscovered(reference, hosts, buckets);
    if (classification.kind === "owned") owned += 1;
    else skipped += 1;
    domains[reference.domain] = (domains[reference.domain] ?? 0) + 1;
  }
  return { discovered: discovered.length, owned, skipped, domains };
}

async function run() {
  const command = process.argv[2];
  if (!command || !COMMANDS.has(command as Command)) {
    throw new Error("command_required: inventory|copy|verify|cutover|rollback|delete-source");
  }
  const typedCommand = command as Command;
  const execute = process.argv.includes("--execute");
  const dryRun = !execute;
  const runIdValue = argument("run-id");
  const storeId = optionalStoreId();
  const batchSize = integerArgument("batch-size", 50);
  if (execute && process.argv.includes("--dry-run")) {
    throw new Error("execute_and_dry_run_are_mutually_exclusive");
  }
  if (execute && !runIdValue) throw new Error("run_id_uuid_required");
  const runId = runIdValue ? requireUuid("run_id", runIdValue) : randomUUID();
  if (execute && typedCommand === "inventory" && !storeId) {
    throw new Error("store_id_uuid_required");
  }
  const confirmedAfterRaw = argument("confirmed-after");
  if (execute && typedCommand === "delete-source" && !confirmedAfterRaw) {
    throw new Error("confirmed_after_required");
  }
  const confirmedAfter = confirmedAfterRaw ? new Date(confirmedAfterRaw) : null;
  if (confirmedAfter && Number.isNaN(confirmedAfter.getTime())) {
    throw new Error("invalid_confirmed_after");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_not_set");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const hosts = allowedHosts();
    const buckets = allowedBuckets();
    if (typedCommand === "inventory") {
      const discovered = await discoverLegacyReferences(sql, runId, storeId);
      const summary = summarize(discovered, hosts, buckets);
      if (dryRun) {
        console.log(JSON.stringify({
          command: typedCommand,
          mode: "dry-run",
          writes: 0,
          ...summary,
        }, null, 2));
        return;
      }

      const config = getR2Config();
      const repository = new PostgresMigrationRepository(sql);
      await repository.ensureRun({ runId, storeId: storeId! });
      const engine = createMediaMigrationEngine({
        repository,
        sourceStorage: getObjectStorage("supabase"),
        targetStorage: getObjectStorage("r2"),
        targetBucket: (visibility) => visibility === "public"
          ? config.publicBucket
          : config.privateBucket,
      });
      let inventoried = 0;
      let skipped = 0;
      let quarantined = 0;
      for (const reference of discovered) {
        const classification = classifyDiscovered(reference, hosts, buckets);
        if (classification.kind === "owned") {
          const input: MediaMigrationInventoryInput = {
            runId,
            storeId: reference.storeId,
            sourceProvider: classification.coordinates.provider,
            sourceBucket: classification.coordinates.bucket,
            sourceKey: classification.coordinates.key,
            purpose: reference.purpose,
            targetId: reference.targetId,
            domain: reference.domain,
            visibility: reference.visibility,
            originalFileName: reference.originalFileName,
            mimeType: reference.mimeType,
            references: [reference.reference],
          };
          const item = await engine.inventory(input);
          if (item.status === "quarantined") quarantined += 1;
          else inventoried += 1;
        } else {
          await engine.skipExternal({
            runId,
            storeId: reference.storeId,
            sourceBucket: classification.coordinates.sourceBucket,
            sourceKey: classification.coordinates.sourceKey,
            purpose: reference.purpose,
            targetId: reference.targetId,
            domain: reference.domain,
            visibility: reference.visibility,
            originalFileName: reference.originalFileName,
            mimeType: reference.mimeType,
            references: [reference.reference],
          });
          skipped += 1;
        }
      }
      console.log(JSON.stringify({
        command: typedCommand,
        mode: "execute",
        runId,
        inventoried,
        skipped,
        quarantined,
      }, null, 2));
      return;
    }

    if (dryRun && !runIdValue) {
      console.log(JSON.stringify({
        command: typedCommand,
        mode: "dry-run",
        writes: 0,
        requiresRunIdForExecute: true,
      }, null, 2));
      return;
    }

    const repository = new PostgresMigrationRepository(sql);
    await repository.requireRun(runId);
    const statuses: Record<Exclude<Command, "inventory">, MediaMigrationStatus[]> = {
      copy: ["inventoried", "failed"],
      verify: ["copied"],
      cutover: ["verified"],
      rollback: ["cutover"],
      "delete-source": ["cutover"],
    };
    const candidates = await repository.listItems(
      runId,
      statuses[typedCommand as Exclude<Command, "inventory">],
      batchSize,
    );
    if (dryRun) {
      console.log(JSON.stringify({
        command: typedCommand,
        mode: "dry-run",
        writes: 0,
        runId,
        candidates: candidates.length,
        batchSize,
      }, null, 2));
      return;
    }

    const config = getR2Config();
    const engine = createMediaMigrationEngine({
      repository,
      sourceStorage: getObjectStorage("supabase"),
      targetStorage: getObjectStorage("r2"),
      targetBucket: (visibility) => visibility === "public"
        ? config.publicBucket
        : config.privateBucket,
    });
    const results: Record<string, number> = {};
    for (const candidate of candidates) {
      const result = typedCommand === "copy"
        ? await engine.copy(candidate.id)
        : typedCommand === "verify"
          ? await engine.verify(candidate.id)
          : typedCommand === "cutover"
            ? await engine.cutover(candidate.id)
            : typedCommand === "rollback"
              ? await engine.rollback(candidate.id)
              : await engine.deleteSource(candidate.id, {
                confirmedAfter: confirmedAfter!,
              });
      results[result.status] = (results[result.status] ?? 0) + 1;
    }
    const runCounts = await repository.reconcileRun(runId, typedCommand);
    console.log(JSON.stringify({
      command: typedCommand,
      mode: "execute",
      runId,
      processed: candidates.length,
      results,
      run: runCounts,
    }, null, 2));
  } finally {
    await sql.end();
  }
}

await run();
