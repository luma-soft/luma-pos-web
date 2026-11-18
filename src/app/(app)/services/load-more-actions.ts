"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getServiceProjectsPage } from "@/lib/data/services";
import { parsePageSize } from "@/lib/pagination";
import { requirePageFeature } from "@/lib/tenancy/page-feature";
import { serviceProjectsFilters, type ServiceSearchParams } from "./service-projects-query";

/** Phone auto load-more for service projects: one more page with the same filters. */
export async function loadServiceProjectsPage(params: ServiceSearchParams, page: number) {
  await requirePageFeature("field_services");
  const context = await requireStoreContext();
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  return (await getServiceProjectsPage(context.storeId, { ...serviceProjectsFilters(params), page: safePage, pageSize: parsePageSize(params.size) })).rows;
}
