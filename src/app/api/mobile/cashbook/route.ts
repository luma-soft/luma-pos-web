import { createCashTxForUser } from "@/lib/actions/cashbook";
import { getCashbook } from "@/lib/data/cashbook";
import { requireMobileManager } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const data = await getCashbook({
    fund: searchParam(request, "fund"),
    type: searchParam(request, "type"),
    page: numberParam(request, "page", 1),
    pageSize: numberParam(request, "pageSize", 30),
  });
  return mobileOk(data);
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await createCashTxForUser(
      gate.userId,
      body as Parameters<typeof createCashTxForUser>[1],
    ),
  );
}
