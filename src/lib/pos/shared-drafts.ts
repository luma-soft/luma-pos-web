import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { posSharedDrafts } from "@/db/schema";

const MAX_SYNCED_DRAFTS = 100;
const MAX_DELETED_IDS = 500;
const MAX_PAYLOAD_BYTES = 512_000;
const MAX_TOTAL_PAYLOAD_BYTES = 2_000_000;
const draftIdSchema = z.string().trim().min(1).max(128);
const deletedDraftSchema = z.object({
  id: draftIdSchema,
  modifiedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

const draftSchema = z.object({
  id: draftIdSchema,
  modifiedAt: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
}).superRefine((draft, context) => {
  if (draft.payload.id !== draft.id) {
    context.addIssue({ code: "custom", path: ["payload", "id"], message: "Draft id must match payload id" });
  }
  if (draft.modifiedAt && !Number.isFinite(Date.parse(draft.modifiedAt))) {
    context.addIssue({ code: "custom", path: ["modifiedAt"], message: "Invalid modifiedAt" });
  }
  if (Buffer.byteLength(JSON.stringify(draft.payload), "utf8") > MAX_PAYLOAD_BYTES) {
    context.addIssue({ code: "custom", path: ["payload"], message: "Draft payload is too large" });
  }
});

export const sharedPosDraftSyncSchema = z.object({
  drafts: z.array(draftSchema).max(MAX_SYNCED_DRAFTS),
  deletedIds: z.array(deletedDraftSchema).max(MAX_DELETED_IDS).default([]),
}).superRefine((input, context) => {
  const totalBytes = input.drafts.reduce(
    (total, draft) => total + Buffer.byteLength(JSON.stringify(draft.payload), "utf8"),
    0,
  );
  if (totalBytes > MAX_TOTAL_PAYLOAD_BYTES) {
    context.addIssue({ code: "custom", path: ["drafts"], message: "Shared draft update is too large" });
  }
});

export type SharedPosDraftInput = z.infer<typeof draftSchema>;
export type SharedPosDraftRecord = {
  id: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
};

function serializePayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializePayload).join(",")}]`;
  if (value != null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${serializePayload(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function toRecord(row: typeof posSharedDrafts.$inferSelect): SharedPosDraftRecord {
  return {
    id: row.draftId,
    payload: row.payload,
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt != null,
  };
}

export async function getSharedPosDrafts(storeId: string, ownerUserId: string) {
  const rows = await db
    .select()
    .from(posSharedDrafts)
    .where(and(
      eq(posSharedDrafts.storeId, storeId),
      eq(posSharedDrafts.ownerUserId, ownerUserId),
    ))
    .orderBy(asc(posSharedDrafts.updatedAt), asc(posSharedDrafts.draftId));
  return rows.map(toRecord);
}

export async function syncSharedPosDrafts(
  storeId: string,
  ownerUserId: string,
  actorUserId: string,
  input: z.infer<typeof sharedPosDraftSyncSchema>,
) {
  const changedDraftIds = input.drafts.map((draft) => draft.id);
  const deletedDrafts = new Map(
    input.deletedIds
      .filter((draft) => !changedDraftIds.includes(draft.id))
      .map((draft) => [draft.id, new Date(draft.modifiedAt)]),
  );
  const writeTime = new Date();

  await db.transaction(async (tx) => {
    const affectedIDs = [...new Set([...changedDraftIds, ...deletedDrafts.keys()])];
    const existingRows = affectedIDs.length
      ? await tx.select().from(posSharedDrafts).where(and(
          eq(posSharedDrafts.storeId, storeId),
          eq(posSharedDrafts.ownerUserId, ownerUserId),
          inArray(posSharedDrafts.draftId, affectedIDs),
        ))
      : [];
    const existingByID = new Map(existingRows.map((row) => [row.draftId, row]));

    for (const draft of input.drafts) {
      const current = existingByID.get(draft.id);
      const modifiedAt = draft.modifiedAt ? new Date(draft.modifiedAt) : writeTime;
      if (current && modifiedAt.getTime() <= current.updatedAt.getTime()) continue;
      if (current && !current.deletedAt
        && serializePayload(current.payload) === serializePayload(draft.payload)) continue;

      await tx.insert(posSharedDrafts).values({
        storeId,
        ownerUserId,
        draftId: draft.id,
        payload: draft.payload,
        updatedAt: modifiedAt,
        deletedAt: null,
        updatedBy: actorUserId,
      }).onConflictDoUpdate({
        target: [posSharedDrafts.storeId, posSharedDrafts.ownerUserId, posSharedDrafts.draftId],
        setWhere: sql`excluded.updated_at > ${posSharedDrafts.updatedAt}`,
        set: {
          payload: draft.payload,
          updatedAt: modifiedAt,
          deletedAt: null,
          updatedBy: actorUserId,
        },
      });
    }

    for (const [id, modifiedAt] of deletedDrafts) {
      const current = existingByID.get(id);
      if (!current || current.deletedAt || modifiedAt.getTime() <= current.updatedAt.getTime()) continue;
      await tx.update(posSharedDrafts)
        .set({ updatedAt: modifiedAt, deletedAt: modifiedAt, updatedBy: actorUserId })
        .where(and(
          eq(posSharedDrafts.storeId, storeId),
          eq(posSharedDrafts.ownerUserId, ownerUserId),
          eq(posSharedDrafts.draftId, id),
          lt(posSharedDrafts.updatedAt, modifiedAt),
          isNull(posSharedDrafts.deletedAt),
        ));
    }
  });

  return getSharedPosDrafts(storeId, ownerUserId);
}
