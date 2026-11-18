"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getInventory, getPurchases } from "@/lib/data/inventory";
import { getPurchaseReturns } from "@/lib/data/purchase-returns";
import { parsePageSize } from "@/lib/pagination";
import { purchaseReturnsListFilters } from "./purchase-returns";
import { purchasesListFilters } from "./purchases";
import { getStocktakeListPage } from "./stocktakes";
import { parseStockStatus } from "./stock";
import { getCategoriesWithCounts } from "@/lib/data/categories";

/**
 * Phone auto load-more for inventory documents: one more page with exactly the
 * filters the server page applied, in the caller's store.
 */
type SP = Record<string, string | undefined>;

function safePage(page: number) {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function loadPurchasesPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getPurchases(context.storeId, { ...purchasesListFilters(params), page: safePage(page), pageSize: parsePageSize(params.size) })).rows;
}

export async function loadPurchaseReturnsPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getPurchaseReturns(context.storeId, { ...purchaseReturnsListFilters(params), page: safePage(page), pageSize: parsePageSize(params.size) })).rows;
}

export async function loadStocktakesPage(params: SP, page: number) {
  const context = await requireStoreContext();
  const result = await getStocktakeListPage(context, params, safePage(page), parsePageSize(params.size));
  // Past the last page the query clamps to it; return nothing instead of repeats.
  return result.page === safePage(page) ? result.rows : [];
}

export async function loadStockPage(params: SP, page: number) {
  const context = await requireStoreContext();
  const status = parseStockStatus(params.stockStatus);
  if (!status) return [];
  return (await getInventory(context.storeId, {
    q: params.q,
    stock: status,
    categoryId: params.category || undefined,
    page: safePage(page),
    pageSize: parsePageSize(params.size),
  })).rows;
}

export async function loadCategoriesPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getCategoriesWithCounts(context.storeId, { page: safePage(page), pageSize: parsePageSize(params.size) })).rows;
}
