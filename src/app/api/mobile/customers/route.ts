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
  if (!gate.ok) return mobileGate(gate)!;

  return mobileOk(
    await getCustomers(
      gate.storeId,
      {
        q: searchParam(request, "q"),
        type: searchParam(request, "type"),
        owing: searchParam(request, "owing") === "true",
        createdFrom: searchParam(request, "createdFrom"),
        createdTo: searchParam(request, "createdTo"),
        lastTxFrom: searchParam(request, "lastTxFrom"),
        lastTxTo: searchParam(request, "lastTxTo"),
        totalFrom: searchParam(request, "totalFrom"),
        totalTo: searchParam(request, "totalTo"),
        debtFrom: searchParam(request, "debtFrom"),
        debtTo: searchParam(request, "debtTo"),
        page: numberParam(request, "page", 1),
        pageSize: numberParam(request, "pageSize", 50),
      },
      { includeHistory: false },
    )
  );
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(
    await createCustomerCore(gate.storeId, body as Parameters<typeof createCustomerCore>[1], gate.userId)
  );
}
