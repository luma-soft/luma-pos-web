"use server";

import { searchPosProductRows } from "@/lib/data/pos";
import type { PosProduct } from "@/lib/data/pos";
import { requireSalesAccess } from "./common";

/** Tìm sản phẩm cho POS (server-side, bỏ dấu). Trả [] nếu query rỗng. */
export async function searchPosProducts(q: string): Promise<PosProduct[]> {
  if (!q.trim()) return [];
  const gate = await requireSalesAccess();
  if (!gate.ok) return [];
  return searchPosProductRows(gate.storeId, q.trim());
}
