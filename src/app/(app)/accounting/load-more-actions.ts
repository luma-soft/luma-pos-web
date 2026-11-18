"use server";

import { requireStoreRole } from "@/lib/auth/store-context";
import { getRevenueBook } from "@/lib/data/accounting";
import { getRawStorePrefs } from "@/lib/data/settings";
import { parsePageSize } from "@/lib/pagination";
import { revenueBookQuery, type AccountingSearchParams } from "./revenue-book-query";

/** Phone auto load-more for the revenue book: one more page, same period and filters. */
export async function loadRevenueBookPage(params: AccountingSearchParams, page: number) {
  const context = await requireStoreRole(["owner", "manager"]);
  const prefs = await getRawStorePrefs(context.storeId);
  const { filters } = revenueBookQuery(params);
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return (await getRevenueBook(context.storeId, prefs.tax, { ...filters, page: safePage, pageSize: parsePageSize(params.size) })).rows;
}
