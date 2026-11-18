"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getOrders } from "@/lib/data/orders";
import { getReturns } from "@/lib/data/returns";
import { parsePageSize } from "@/lib/pagination";
import { bookingsListFilters } from "./bookings";
import { ordersListFilters } from "./orders";
import { quotesListFilters } from "./quotes";
import { returnsListFilters } from "./returns";

/**
 * Phone auto load-more: return one more page of a sales list using exactly the
 * filters the server page applied (same parsers, same store scope).
 */
type SP = Record<string, string | undefined>;

function pageArgs(params: SP, page: number) {
  return { page: Number.isInteger(page) && page > 0 ? page : 1, pageSize: parsePageSize(params.size) };
}

export async function loadOrdersPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getOrders(context.storeId, { ...ordersListFilters(params), ...pageArgs(params, page) })).rows;
}

export async function loadReturnsPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getReturns(context.storeId, { ...returnsListFilters(params), ...pageArgs(params, page) })).rows;
}

export async function loadQuotesPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getOrders(context.storeId, { ...quotesListFilters(params), ...pageArgs(params, page) })).rows;
}

export async function loadBookingsPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getOrders(context.storeId, { ...bookingsListFilters(params), ...pageArgs(params, page) })).rows;
}
