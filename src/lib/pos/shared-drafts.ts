import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { posSharedDrafts } from "@/db/schema";

export type SharedPosDraftRecord = {
  id: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
};

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
