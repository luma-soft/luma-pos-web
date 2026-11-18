"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getCustomers, getSuppliers } from "@/lib/data/partners";
import { getProjectPage } from "@/lib/data/projects";
import { parsePageSize } from "@/lib/pagination";
import { normalizeFilters } from "./customers";
import { suppliersListFilters } from "./suppliers";

/**
 * Phone auto load-more for partner lists: one more page with exactly the filters
 * the server page applied, in the caller's store.
 */
type SP = Record<string, string | undefined>;

function safePage(page: number) {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function loadCustomersPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getCustomers(context.storeId, normalizeFilters(params, safePage(page), parsePageSize(params.size)))).rows;
}

export async function loadSuppliersPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getSuppliers(context.storeId, { ...suppliersListFilters(params), page: safePage(page), pageSize: parsePageSize(params.size) })).rows;
}

export async function loadProjectsPage(params: SP, page: number) {
  const context = await requireStoreContext();
  return (await getProjectPage(context.storeId, safePage(page), parsePageSize(params.size))).rows;
}
