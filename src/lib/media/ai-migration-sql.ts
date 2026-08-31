type AiAttachmentCoordinate = {
  sortOrder: number;
  storeId: string;
  recordId: string;
};

type AiAttachmentCutoverCoordinate = AiAttachmentCoordinate & {
  mediaId: string;
  targetBucket: string;
  targetKey: string;
};

type AiAttachmentRollbackCoordinate = AiAttachmentCoordinate & {
  sourceBucket: string;
  sourceKey: string;
};

export type ParameterizedSql = {
  text: string;
  parameters: Array<string | number>;
};

export function buildAiAttachmentCutoverSql(
  input: AiAttachmentCutoverCoordinate,
): ParameterizedSql {
  return {
    text: `
      update ai_chat_messages
      set attachments = (
        select jsonb_agg(
          case when ordinality - 1 = $1::bigint
            then (attachment - 'signedUrl') || jsonb_build_object(
              'mediaId', $2::text,
              'bucket', $3::text,
              'path', $4::text
            )
            else attachment
          end
          order by ordinality
        )
        from jsonb_array_elements(attachments) with ordinality
          as entries(attachment, ordinality)
      )
      where store_id = $5::uuid
        and id = $6::uuid
    `,
    parameters: [
      input.sortOrder,
      input.mediaId,
      input.targetBucket,
      input.targetKey,
      input.storeId,
      input.recordId,
    ],
  };
}

export function buildAiAttachmentRollbackSql(
  input: AiAttachmentRollbackCoordinate,
): ParameterizedSql {
  return {
    text: `
      update ai_chat_messages
      set attachments = (
        select jsonb_agg(
          case when ordinality - 1 = $1::bigint
            then (attachment - 'mediaId' - 'signedUrl')
              || jsonb_build_object(
                'bucket', $2::text,
                'path', $3::text
              )
            else attachment
          end
          order by ordinality
        )
        from jsonb_array_elements(attachments) with ordinality
          as entries(attachment, ordinality)
      )
      where store_id = $4::uuid
        and id = $5::uuid
    `,
    parameters: [
      input.sortOrder,
      input.sourceBucket,
      input.sourceKey,
      input.storeId,
      input.recordId,
    ],
  };
}
