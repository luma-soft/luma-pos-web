"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getCashbook } from "@/lib/data/cashbook";
import { parsePageSize } from "@/lib/pagination";

/** Phone auto load-more for the cashbook: one more page with the same filters. */
type SP = Record<string, string | undefined>;

export async function loadCashbookPage(params: SP, page: number) {
  const context = await requireStoreContext();
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return (await getCashbook(context.storeId, { fund: params.fund, type: params.type, page: safePage, pageSize: parsePageSize(params.size) })).rows;
}
