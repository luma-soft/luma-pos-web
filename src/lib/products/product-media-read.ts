import { sql } from "drizzle-orm";

import {
  getPublicMediaConfig,
  type PublicMediaConfig,
} from "@/lib/media/config";
import {
  productMediaEligibilitySql,
  type ProductMediaEligibilityColumns,
} from "@/lib/products/product-media-eligibility";

export type ProductManagedImageDescriptor = {
  mediaId: string;
  path: string;
  url: string;
};

function publicPrefix(publicMedia: PublicMediaConfig) {
  return `${publicMedia.publicBaseUrl}/`;
}

function mediaColumns(
  alias: "media" | "direct_media",
): ProductMediaEligibilityColumns {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  return {
    id: column("id"),
    storeId: column("store_id"),
    provider: column("provider"),
    visibility: column("visibility"),
    purpose: column("purpose"),
    targetId: column("target_id"),
    domain: column("domain"),
    bucket: column("bucket"),
    objectKey: column("object_key"),
    mimeType: column("mime_type"),
    status: column("status"),
    deletedAt: column("deleted_at"),
  };
}

export function productManagedImageDescriptors(
  storeId: string,
  publicMedia: PublicMediaConfig = getPublicMediaConfig(),
) {
  const eligible = productMediaEligibilitySql(mediaColumns("media"), {
    storeId,
    targetIds: [sql`products.id`],
    publicMedia,
  });
  return sql<ProductManagedImageDescriptor[]>`coalesce((
    select json_agg(json_build_object(
      'mediaId', media.id,
      'path', media.object_key,
      'url', ${publicPrefix(publicMedia)} || media.object_key
    ) order by relation.sort_order)
    from product_media relation
    join media_objects media
      on media.store_id = relation.store_id
     and media.id = relation.media_object_id
    where relation.store_id = ${storeId}::uuid
      and relation.product_id = products.id
      and relation.deleted_at is null
      and ${eligible}
  ), '[]'::json)`;
}

export function productCompatibilityImageUrls(
  storeId: string,
  publicMedia: PublicMediaConfig = getPublicMediaConfig(),
) {
  const directEligible = productMediaEligibilitySql(
    mediaColumns("direct_media"), {
    storeId,
    targetIds: [sql`products.id`],
    publicMedia,
  });
  const selectedEligible = productMediaEligibilitySql(mediaColumns("media"), {
    storeId,
    targetIds: [sql`relation.product_id`],
    publicMedia,
  });
  return sql<string[]>`coalesce((
    select json_agg(image.url order by image.source_order, image.sort_order)
    from (
      select external_image.url, 0::integer as source_order,
        external_image.ordinality::integer as sort_order
      from jsonb_array_elements_text(
        coalesce(products.image_urls, '[]'::jsonb)
      ) with ordinality as external_image(url, ordinality)

      union all

      select ${publicPrefix(publicMedia)} || media.object_key as url,
        1::integer as source_order, relation.sort_order
      from product_media relation
      join media_objects media
        on media.store_id = relation.store_id
       and media.id = relation.media_object_id
      where relation.store_id = ${storeId}::uuid
        and relation.deleted_at is null
        and relation.product_id = case
          when exists (
            select 1
            from product_media direct_relation
            join media_objects direct_media
              on direct_media.store_id = direct_relation.store_id
             and direct_media.id = direct_relation.media_object_id
            where direct_relation.store_id = ${storeId}::uuid
              and direct_relation.product_id = products.id
              and direct_relation.deleted_at is null
              and ${directEligible}
          ) then products.id
          else coalesce(products.parent_product_id, products.id)
        end
        and ${selectedEligible}
    ) image
  ), '[]'::json)`;
}
