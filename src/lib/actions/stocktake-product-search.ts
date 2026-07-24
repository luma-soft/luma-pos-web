"use server";

import {
  searchStocktakeProductRows,
  type StocktakeProductOption,
} from "@/lib/data/stocktake-products";
import { createClient } from "@/lib/supabase/server";

/** Tìm sản phẩm cho phiếu kiểm kho trên toàn bộ danh mục. */
export async function searchStocktakeProducts(
  query: string,
  warehouseId: string,
): Promise<StocktakeProductOption[]> {
  if (!query.trim() || !warehouseId) return [];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  return searchStocktakeProductRows(query, warehouseId);
}
