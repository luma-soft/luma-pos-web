import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { internalUseIssues, internalUseItems, profiles } from "@/db/schema";

/** Lịch sử phiếu xuất nội bộ (audit) — mới nhất trước. */
export async function getInternalUseIssues(limit = 50) {
  const creator = alias(profiles, "iu_creator");
  return db
    .select({
      id: internalUseIssues.id,
      code: internalUseIssues.code,
      department: internalUseIssues.department,
      reason: internalUseIssues.reason,
      status: internalUseIssues.status,
      totalCost: internalUseIssues.totalCost,
      note: internalUseIssues.note,
      createdAt: internalUseIssues.createdAt,
      createdByName: creator.fullName,
      itemCount: sql<number>`(select count(*) from ${internalUseItems} where ${internalUseItems.issueId} = ${internalUseIssues.id})::int`,
    })
    .from(internalUseIssues)
    .leftJoin(creator, eq(internalUseIssues.createdBy, creator.id))
    .orderBy(desc(internalUseIssues.createdAt))
    .limit(limit);
}

export type InternalUseIssueRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];
