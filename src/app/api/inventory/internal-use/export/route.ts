import { requireStockAccess } from "@/lib/actions/common";
import { getInternalUseIssueCount, getInternalUseIssues } from "@/lib/data/internal-use";
import { internalUseCsv } from "@/lib/inventory/internal-use-export";

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.error === "errors.forbidden" ? 403 : 401 });
  const params = new URL(request.url).searchParams;
  const filters = Object.fromEntries(["q", "status", "reason", "department", "from", "to"].map(key => [key, params.get(key) ?? undefined]));
  const total = await getInternalUseIssueCount(gate.storeId, filters);
  const rows = total ? await getInternalUseIssues(gate.storeId, { ...filters, limit: total }) : [];
  return new Response(internalUseCsv(rows), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="phieu-xuat-noi-bo.csv"',
    "Cache-Control": "private, no-store",
  } });
}
