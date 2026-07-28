import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { internalUseIssues, internalUseItems, products, profiles, warehouses } from "@/db/schema";
import {
  resolveAuthoritativeInternalUseWarehouse,
  type InternalUseWarehouse,
} from "@/lib/inventory/internal-use-warehouse";

export async function getAuthoritativeInternalUseWarehouse(): Promise<InternalUseWarehouse | null> {
  const rows = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses);
  return resolveAuthoritativeInternalUseWarehouse(rows);
}

/** Lịch sử phiếu xuất nội bộ (audit) — mới nhất trước. */
export async function getInternalUseIssues({ limit = 50, q }: { limit?: number; q?: string } = {}) {
  const creator = alias(profiles, "iu_creator");
  const search = q?.trim();
  const searchCondition = search
    ? or(
      ilike(internalUseIssues.code, `%${search}%`),
      ilike(internalUseIssues.department, `%${search}%`),
      ilike(internalUseIssues.reason, `%${search}%`),
      ilike(internalUseIssues.note, `%${search}%`),
      ilike(warehouses.name, `%${search}%`),
    )
    : undefined;

  const rows = await db
    .select({
      id: internalUseIssues.id,
      code: internalUseIssues.code,
      warehouseName: warehouses.name,
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
    .leftJoin(warehouses, eq(internalUseIssues.warehouseId, warehouses.id))
    .leftJoin(creator, eq(internalUseIssues.createdBy, creator.id))
    .where(searchCondition)
    .orderBy(desc(internalUseIssues.createdAt))
    .limit(limit);

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];

  const itemRows = await db
    .select({
      id: internalUseItems.id,
      issueId: internalUseItems.issueId,
      sku: products.sku,
      productName: internalUseItems.productName,
      unitName: internalUseItems.unitName,
      quantity: internalUseItems.quantity,
      unitCost: internalUseItems.unitCost,
      total: internalUseItems.total,
    })
    .from(internalUseItems)
    .leftJoin(products, eq(internalUseItems.productId, products.id))
    .where(inArray(internalUseItems.issueId, ids))
    .orderBy(internalUseItems.productName);

  const itemsByIssue = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const current = itemsByIssue.get(item.issueId) ?? [];
    current.push(item);
    itemsByIssue.set(item.issueId, current);
  }

  return rows.map((row) => ({ ...row, items: itemsByIssue.get(row.id) ?? [] }));
}

export type InternalUseIssueRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];
