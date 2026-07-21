import { createCustomerCore } from "@/lib/customers/write";
import { getCustomers } from "@/lib/data/partners";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  return mobileOk(
    await getCustomers({
      q: searchParam(request, "q"),
      type: searchParam(request, "type"),
      owing: searchParam(request, "owing") === "true",
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    })
  );
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(
    await createCustomerCore(body as Parameters<typeof createCustomerCore>[0])
  );
}
