import { getCustomerPartnerDetail, getCustomers, type CustomerFilters } from "@/lib/data/partners";
import { parsePageSize } from "@/lib/pagination";
import { CustomersTable } from "./customers-table";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { requireStoreContext } from "@/lib/auth/store-context";
import { z } from "zod";

type SP = Record<string, string | undefined>;
const FILTER_KEYS = [
  "q",
  "type",
  "owing",
  "createdFrom",
  "createdTo",
  "lastTxFrom",
  "lastTxTo",
  "totalFrom",
  "totalTo",
  "debtFrom",
  "debtTo",
] as const;

export async function CustomersTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const filters = normalizeFilters(params, page, pageSize);
  const detailCustomerId = params.detailCustomerId || null;
  const [data, returnPrintTemplates, detailCustomer] = await Promise.all([
    getCustomers(context.storeId, filters),
    getPrintTemplatesForDoc(context.storeId, "return"),
    detailCustomerId && z.uuid().safeParse(detailCustomerId).success ? getCustomerPartnerDetail(context.storeId, detailCustomerId) : null,
  ]);

  return <CustomersTable key={detailCustomerId ?? "customers"} data={data} filters={filters} returnPrintTemplates={returnPrintTemplates} aiPreview={params.source === "ai-preview"} initialDetailId={detailCustomerId} initialDetailCustomer={detailCustomer} />;
}

function normalizeFilters(params: SP, page: number, pageSize: number): CustomerFilters {
  const filters: CustomerFilters = { page, pageSize, owing: params.owing === "1" };
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (!value) continue;
    if (key === "owing") continue;
    filters[key] = value;
  }
  return filters;
}
