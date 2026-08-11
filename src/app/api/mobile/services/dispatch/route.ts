import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import {
  getServiceDispatchPage,
  parseServiceDispatchQuery,
  requireMobileServiceManager,
} from "../manager-dependencies";

export async function GET(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  try {
    const query = parseServiceDispatchQuery(new URL(request.url).searchParams);
    return mobileOk(await getServiceDispatchPage(query));
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith("SERVICE_DISPATCH_")
    ) return mobileError("errors.invalidData", 400);
    console.error("service dispatch failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
