import { sql, type SQL } from "drizzle-orm";
import type { MediaActor } from "@/lib/media/authorization";
import type { PublicMediaConfig } from "@/lib/media/config";
import { STOCK_READ_ROLES } from "@/lib/auth/roles";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";
import { productMediaEligibilitySql, type ProductMediaEligibilityColumns } from "@/lib/products/product-media-eligibility";
import { MEDIA_LIBRARY_PRESETS, type MediaLibraryPreset } from "@/lib/media/library-source-types";
import { MEDIA_LIBRARY_IMAGE_MIME_TYPES } from "@/lib/media/library-schema";

export type MediaLibrarySourceContext = { actor: MediaActor; publicMedia: PublicMediaConfig };

function canReadProducts(context: MediaLibrarySourceContext) {
  return (STOCK_READ_ROLES as readonly string[]).includes(context.actor.role);
}
function canReadConstruction(context: MediaLibrarySourceContext) {
  return storeFeatureEnabled(context.actor.features, "field_services")
    && ["owner", "manager", "technician"].includes(context.actor.role);
}

export function mediaLibrarySourcePresets(context: MediaLibrarySourceContext) {
  const keys: MediaLibraryPreset[] = [];
  if (canReadProducts(context)) keys.push("products");
  if (canReadConstruction(context)) keys.push("camera", "electrical", "plumbing", "mixed");
  return MEDIA_LIBRARY_PRESETS.filter((preset) => keys.includes(preset.source)).map((preset) => ({ ...preset, system: true }));
}

const timestamp = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function eligibleProduct(context: MediaLibrarySourceContext) {
  const fields: ProductMediaEligibilityColumns = {
    id: sql`m.id`, storeId: sql`m.store_id`, provider: sql`m.provider`, visibility: sql`m.visibility`,
    purpose: sql`m.purpose`, targetId: sql`m.target_id`, domain: sql`m.domain`, bucket: sql`m.bucket`,
    objectKey: sql`m.object_key`, mimeType: sql`m.mime_type`, status: sql`m.status`, deletedAt: sql`m.deleted_at`,
  };
  return productMediaEligibilitySql(fields, {
    storeId: context.actor.storeId, targetIds: [sql`pr.id`], publicMedia: context.publicMedia,
  });
}

function productRows(context: MediaLibrarySourceContext): SQL {
  const storeId = context.actor.storeId;
  const prefix = `${context.publicMedia.publicBaseUrl}/`;
  // Conservative URL grammar before counts/signing: DNS names or canonical IPv4,
  // no credentials, ambiguous numeric hosts, malformed IPv6, controls or bad ports.
  const octet = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
  const host = `(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|${octet}(?:\\.${octet}){3})`;
  const urlPattern = `^https?://${host}(?::[0-9]{1,5})?(?:[/?#]|$)`;
  return sql`
    select 'pm:' || pm.id::text as id, m.id::text as "mediaId", 'Hàng hóa'::text as album,
      pr.name as title, null::text as note, array[pr.sku]::text[] as tags,
      ${timestamp(sql`pm.created_at`)} as "createdAt", null::text as "creatorName",
      m.provider, m.bucket, m.object_key as "objectKey", m.thumbnail_object_key as "thumbnailObjectKey",
      m.original_file_name as "fileName", m.mime_type as "mimeType", m.size_bytes::float8 as "sizeBytes",
      null::jsonb as metadata, jsonb_build_object('type','product','id',pr.id,'label',pr.name) as source,
      ${prefix} || m.object_key as "directUrl", true as "sizeKnown", ${timestamp(sql`m.created_at`)} as "uploadedAt",
      false as "canExtractMetadata", pm.created_at as sort_at, 'products'::text as source_key, 0::bigint as storage_bytes
    from product_media pm join products pr on pr.store_id=pm.store_id and pr.id=pm.product_id
    join media_objects m on m.store_id=pm.store_id and m.id=pm.media_object_id
    where pm.store_id=${storeId}::uuid and pm.deleted_at is null and ${eligibleProduct(context)}
    union all
    select 'pu:' || pr.id::text || ':' || md5(e.url), ''::text, 'Hàng hóa'::text,
      pr.name, null::text, array[pr.sku]::text[], ${timestamp(sql`pr.image_updated_at`)}, null::text,
      'r2'::text, ''::text, ''::text, null::text, pr.name, 'image/*'::text, 0::float8,
      null::jsonb, jsonb_build_object('type','product','id',pr.id,'label',pr.name),
      e.url, false, null::text, false, pr.image_updated_at, 'products'::text, 0::bigint
    from products pr cross join lateral (
      select distinct value #>> '{}' as url from jsonb_array_elements(
        case when jsonb_typeof(pr.image_urls)='array' then pr.image_urls else '[]'::jsonb end
      ) where jsonb_typeof(value)='string'
    ) e
    where pr.store_id=${storeId}::uuid
      and e.url ~* ${urlPattern} and e.url !~ '[[:space:][:cntrl:]\\\\]'
      and case when substring(lower(e.url) from '^https?://[^/?#:]+:([0-9]{1,5})(?:[/?#]|$)') is not null
        then substring(lower(e.url) from '^https?://[^/?#:]+:([0-9]{1,5})(?:[/?#]|$)')::int <= 65535 else true end
      and char_length(e.url) <= 4096
      -- The managed host must pass registry eligibility, never the legacy path.
      and substring(lower(e.url) from '^https?://([^/?#:]+)') <> ${new URL(context.publicMedia.publicBaseUrl).hostname.toLowerCase()}
      and not exists (select 1 from products parent
        where parent.store_id=pr.store_id and parent.id=pr.parent_product_id
          and parent.image_urls @> jsonb_build_array(e.url))
  `;
}

function assignedJob(context: MediaLibrarySourceContext, job: "j" | "pj"): SQL {
  return sql`(${sql.raw(`${job}.assigned_to`)} = ${context.actor.userId}::uuid or exists (
    select 1 from service_job_assignments crew
    where crew.store_id = ${context.actor.storeId}::uuid and crew.job_id = ${sql.raw(`${job}.id`)}
      and crew.profile_id = ${context.actor.userId}::uuid and crew.removed_at is null
  ))`;
}

function constructionRows(context: MediaLibrarySourceContext): SQL {
  const manager = context.actor.role === "owner" || context.actor.role === "manager";
  const projectAccess = manager ? sql`true` : sql`p.service_type is not null and exists (
    select 1 from service_jobs pj where pj.store_id=p.store_id and pj.project_id=p.id and ${assignedJob(context, "pj")}
  )`;
  const jobAccess = manager ? sql`true` : assignedJob(context, "j");
  const sourceType = sql`case when sa.asset_id is not null then 'asset' when sa.job_id is not null then 'job' else 'project' end`;
  const trade = sql`case
    when coalesce(j.service_type, aj.service_type)::text in ('camera','electrical','plumbing') then coalesce(j.service_type, aj.service_type)::text
    when p.service_type::text in ('camera','electrical','plumbing') then p.service_type::text else 'mixed' end`;
  const imageMimeTypes = sql.join(MEDIA_LIBRARY_IMAGE_MIME_TYPES.map((mime) => sql`${mime}`), sql`, `);
  return sql`
    select 'sa:' || sa.id::text as id, coalesce(m.id::text,'') as "mediaId",
      case ${trade} when 'camera' then 'Thi công camera' when 'electrical' then 'Thi công điện'
        when 'plumbing' then 'Thi công nước' else 'Thi công tổng hợp' end as album,
      coalesce(nullif(sa.caption,''), a.name, j.title, sa.file_name) as title, sa.caption as note,
      array_remove(array[p.name,j.title,a.name,sa.project_phase,sa.category],null)::text[] as tags,
      ${timestamp(sql`sa.created_at`)} as "createdAt", creator.full_name as "creatorName",
      coalesce(m.provider,'supabase') as provider, coalesce(m.bucket,sa.bucket) as bucket,
      coalesce(m.object_key,sa.path) as "objectKey", m.thumbnail_object_key as "thumbnailObjectKey",
      sa.file_name as "fileName", coalesce(m.mime_type,sa.mime_type) as "mimeType",
      coalesce(m.size_bytes,sa.size_bytes)::float8 as "sizeBytes",
      (select fm.metadata from media_file_metadata fm where fm.store_id=m.store_id and fm.media_object_id=m.id) as metadata,
      jsonb_build_object('type',${sourceType},'id',coalesce(sa.asset_id,sa.job_id,sa.project_id),
        'label',coalesce(a.name,j.title,p.name),'projectId',sa.project_id) as source,
      null::text as "directUrl", true as "sizeKnown", ${timestamp(sql`coalesce(m.created_at,sa.created_at)`)} as "uploadedAt",
      m.id is not null as "canExtractMetadata", sa.created_at as sort_at, ${trade} as source_key, 0::bigint as storage_bytes
    from service_attachments sa join projects p on p.store_id=sa.store_id and p.id=sa.project_id
    left join service_jobs j on j.store_id=sa.store_id and j.id=sa.job_id and j.project_id=p.id
    left join installed_assets a on a.store_id=sa.store_id and a.id=sa.asset_id and a.project_id=p.id
    left join service_jobs aj on aj.store_id=a.store_id and aj.id=a.job_id and aj.project_id=p.id
    left join profiles creator on creator.store_id=sa.store_id and creator.id=sa.created_by
    left join media_objects m on m.store_id=sa.store_id and m.id=sa.media_object_id
    where sa.store_id=${context.actor.storeId}::uuid and sa.deleted_at is null and sa.storage_deleted_at is null
      and sa.claim_id is null and sa.request_id is null and sa.category <> 'signature'
      and sa.mime_type in (${imageMimeTypes})
      and (
        (sa.asset_id is not null and a.id is not null and sa.category='asset' and ${manager})
        or (sa.asset_id is null and sa.job_id is not null and j.id is not null and ${jobAccess})
        or (sa.asset_id is null and sa.job_id is null and ${projectAccess})
      )
      and (sa.media_object_id is null or (
        m.id is not null and m.status='ready' and m.deleted_at is null and m.visibility='private' and m.mime_type in (${imageMimeTypes})
        and ((sa.asset_id is not null or sa.job_id is null) and m.purpose='project-document' and m.target_id=p.id and m.domain='projects'
          or sa.asset_id is null and sa.job_id is not null and m.purpose='service-evidence' and m.target_id=j.id and m.domain='service-evidence')
      ))
  `;
}

/** Source rows are references only; every branch applies source ACL before paging. */
export function buildMediaLibrarySourceRows(context: MediaLibrarySourceContext): SQL | null {
  const sources: SQL[] = [];
  if (canReadProducts(context)) sources.push(productRows(context));
  if (canReadConstruction(context)) sources.push(constructionRows(context));
  return sources.length ? sql.join(sources, sql` union all `) : null;
}
