import { createSupplier } from "@/lib/actions/partners";
import { getSuppliers } from "@/lib/data/partners";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  return mobileOk(
    await getSuppliers({
      q: searchParam(request, "q"),
      owing: searchParam(request, "owing") as "owing" | "clear" | undefined,
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    })
  );
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(
    await createSupplier(body as Parameters<typeof createSupplier>[0])
  );
}
