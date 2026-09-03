import { getTableColumns, sql } from "drizzle-orm";
import { mediaObjects } from "@/db/schema";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import { canonicalizeUuidCoordinate } from "@/lib/media/uuid-coordinate";

export type SaveMediaMetadataInput = { storeId: string; mediaId: string; metadata: MediaFileMetadata };

/** Internal selection only; callers must still authorize the media target. */
export const mediaRecordWithMetadata = {
  ...getTableColumns(mediaObjects),
  fileMetadata: sql<MediaFileMetadata | null>`(
    select fm.metadata from media_file_metadata fm
    where fm.store_id = ${mediaObjects.storeId} and fm.media_object_id = ${mediaObjects.id}
      and ${mediaObjects.status} = 'ready' and ${mediaObjects.deletedAt} is null
      and ${mediaObjects.visibility} = 'private'
      and ${mediaObjects.purpose} in ('library-asset', 'project-document', 'service-evidence')
  )`,
};

/** Lock the parent state and use CAS so a late failure cannot replace success. */
export function buildSaveMediaMetadataQuery(input: SaveMediaMetadataInput) {
  return sql`
    with candidate as materialized (
      select store_id, id from media_objects
      where store_id = ${canonicalizeUuidCoordinate(input.storeId)}::uuid
        and id = ${canonicalizeUuidCoordinate(input.mediaId)}::uuid
        and status = 'ready' and deleted_at is null and visibility = 'private'
        and purpose in ('library-asset', 'project-document', 'service-evidence')
      for no key update
    )
    insert into media_file_metadata (store_id, media_object_id, metadata)
    select store_id, id, ${JSON.stringify(input.metadata)}::jsonb from candidate
    on conflict (store_id, media_object_id) do update set metadata = excluded.metadata
      where media_file_metadata.metadata->>'status' = 'failed'
    returning media_object_id
  `;
}
