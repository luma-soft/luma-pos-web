import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { PublicMediaConfig } from "@/lib/media/config";

export type ProductMediaEligibilityColumns = {
  id: SQLWrapper;
  storeId: SQLWrapper;
  provider: SQLWrapper;
  visibility: SQLWrapper;
  purpose: SQLWrapper;
  targetId: SQLWrapper;
  domain: SQLWrapper;
  bucket: SQLWrapper;
  objectKey: SQLWrapper;
  mimeType: SQLWrapper;
  status: SQLWrapper;
  deletedAt: SQLWrapper;
};

/** One eligibility predicate shared by association and every product read. */
export function productMediaEligibilitySql(
  media: ProductMediaEligibilityColumns,
  input: {
    storeId: string;
    targetIds: readonly (string | SQLWrapper)[];
    publicMedia: Pick<PublicMediaConfig, "publicBucket">;
  },
): SQL {
  const targets = sql.join(
    input.targetIds.map((targetId) => sql`${targetId}::uuid`),
    sql`, `,
  );
  return sql`(
    ${media.storeId} = ${input.storeId}::uuid
    and ${media.provider} = 'r2'
    and ${media.bucket} = ${input.publicMedia.publicBucket}
    and ${media.status} = 'ready'
    and ${media.deletedAt} is null
    and ${media.visibility} = 'public'
    and ${media.purpose} = 'product-image'
    and ${media.domain} = 'products'
    and ${media.targetId} in (${targets})
    and ${media.objectKey} ~ (
      '^stores/' || ${input.storeId} ||
      '/products/[0-9]{4}/(0[1-9]|1[0-2])/' ||
      ${media.id}::text || '/original\\.(jpg|png|webp)$'
    )
    and case ${media.mimeType}
      when 'image/jpeg' then ${media.objectKey} like '%.jpg'
      when 'image/png' then ${media.objectKey} like '%.png'
      when 'image/webp' then ${media.objectKey} like '%.webp'
      else false
    end
  )`;
}
