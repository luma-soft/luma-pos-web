import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { internalUseIssues, internalUseItems, products, profiles, warehouses } from "@/db/schema";
import {
  resolveAuthoritativeInternalUseWarehouse,
  type InternalUseWarehouse,
} from "@/lib/inventory/internal-use-warehouse";

type InternalUseFilters = {
  q?: string;
  status?: string;
  warehouseId?: string;
  reason?: string;
  department?: string;
  from?: string;
  to?: string;
};

function internalUseFilterConditions({ q, status, warehouseId, reason, department, from, to }: InternalUseFilters) {
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
  return [
    searchCondition,
    status ? eq(internalUseIssues.status, status) : undefined,
    warehouseId ? eq(internalUseIssues.warehouseId, warehouseId) : undefined,
    reason ? eq(internalUseIssues.reason, reason) : undefined,
    department ? eq(internalUseIssues.department, department) : undefined,
    from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? gte(internalUseIssues.createdAt, new Date(`${from}T00:00:00`)) : undefined,
    to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? lte(internalUseIssues.createdAt, new Date(`${to}T23:59:59.999`)) : undefined,
  ].filter((value): value is SQL => Boolean(value));
}

export async function getAuthoritativeInternalUseWarehouse(): Promise<InternalUseWarehouse | null> {
  const rows = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses);
  return resolveAuthoritativeInternalUseWarehouse(rows);
}

/** Lịch sử phiếu xuất nội bộ (audit) — mới nhất trước. */
export async function getInternalUseIssues({ limit = 50, ...filters }: InternalUseFilters & { limit?: number } = {}) {
  const creator = alias(profiles, "iu_creator");
  const conditions = internalUseFilterConditions(filters);

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
    .where(conditions.length ? and(...conditions) : undefined)
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

export async function getInternalUseIssueCount(filters: InternalUseFilters = {}) {
  const conditions = internalUseFilterConditions(filters);
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(internalUseIssues)
    .leftJoin(warehouses, eq(internalUseIssues.warehouseId, warehouses.id))
    .where(conditions.length ? and(...conditions) : undefined);
  return row?.total ?? 0;
}

export type InternalUseIssueRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];
