import { sql } from "drizzle-orm";
import { categories } from "@/db/schema";
import { UNMANAGED_STOCK_CATEGORY_NAME } from "@/lib/product-stock";

export function stockManagedCategoryCondition() {
  return sql<boolean>`(
    ${categories.name} is null
    or lower(trim(${categories.name})) <> ${UNMANAGED_STOCK_CATEGORY_NAME}
  )`;
}
