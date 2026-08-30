import { sql } from "drizzle-orm";

import { PRODUCT_MEDIA_PUBLIC_ORIGIN } from "@/lib/images/product-image-coordinate";

export function productCompatibilityImageUrls(
  storeId: string,
  publicBaseUrl?: string,
) {
  const publicPrefix = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/+$/, "")}/`
    : `${PRODUCT_MEDIA_PUBLIC_ORIGIN}/`;
  return sql<string[]>`coalesce((
    select json_agg(image.url order by image.source_order, image.sort_order)
    from (
      select external_image.url, 0::integer as source_order,
        external_image.ordinality::integer as sort_order
      from jsonb_array_elements_text(
        coalesce(products.image_urls, '[]'::jsonb)
      ) with ordinality as external_image(url, ordinality)

      union all

      select ${publicPrefix} || media.object_key as url,
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
              and direct_media.status = 'ready'
              and direct_media.deleted_at is null
              and direct_media.visibility = 'public'
              and direct_media.purpose = 'product-image'
              and direct_media.domain = 'products'
              and direct_media.target_id = products.id
          ) then products.id
          else coalesce(products.parent_product_id, products.id)
        end
        and media.status = 'ready'
        and media.deleted_at is null
        and media.visibility = 'public'
        and media.purpose = 'product-image'
        and media.domain = 'products'
        and media.target_id = relation.product_id
    ) image
  ), '[]'::json)`;
}
