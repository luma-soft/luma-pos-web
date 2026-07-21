import { timingSafeEqual } from "node:crypto";
import { processDueEInvoices } from "@/lib/einvoice/worker";
import { mobileError, mobileOk } from "@/lib/mobile/response";

function authorized(request: Request) {
  const expected = (
    process.env.EINVOICE_CRON_SECRET || process.env.CRON_SECRET || ""
  ).trim();
  const actual = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim() ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return mobileError("errors.unauthorized", 401);
  return mobileOk(await processDueEInvoices({ limit: 20 }));
}
