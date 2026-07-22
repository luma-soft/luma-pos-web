import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { coercePageSize } from "@/lib/pagination";

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  productCount: number;
}

/** Danh mục kèm số SP (đếm trực tiếp theo categoryId, không gộp con). */
export async function getCategoriesWithCounts({ page = 1, pageSize }: { page?: number; pageSize?: number } = {}) {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      parentName: sql<string | null>`(select parent.name from categories parent where parent.id = ${categories.parentId})`,
      productCount: sql<number>`count(${products.id})::int`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const normalizedRows = rows.map((r) => ({ ...r, productCount: Number(r.productCount) }));
  const roots = normalizedRows.filter((category) => !category.parentId);
  const orderedRows = roots.flatMap((root) => [root, ...normalizedRows.filter((category) => category.parentId === root.id)]);
  const size = coercePageSize(pageSize);
  const safePage = Math.max(1, page);
  const total = orderedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const offset = (safePage - 1) * size;

  return {
    rows: orderedRows.slice(offset, offset + size),
    roots: roots.map(({ id, name }) => ({ id, name })),
    total,
    pageCount,
  };
}
