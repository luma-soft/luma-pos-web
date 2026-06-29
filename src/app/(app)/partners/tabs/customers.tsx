import { getCustomers, type CustomerFilters } from "@/lib/data/partners";
import { parsePageSize } from "@/lib/pagination";
import { CustomersTable } from "./customers-table";

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
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const filters = normalizeFilters(params, page, pageSize);
  const data = await getCustomers(filters);

  return <CustomersTable data={data} filters={filters} aiPreview={params.source === "ai-preview"} />;
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
