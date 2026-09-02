import { createServiceProject } from "@/lib/actions/services";
import { getServiceProjectsPage } from "@/lib/data/services";
import { requireMobileServiceAccess, requireMobileServiceManager } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  const status = searchParam(request, "status");
  const serviceType = searchParam(request, "serviceType");
  const urgency = searchParam(request, "urgency");
  return mobileOk(await getServiceProjectsPage(gate.storeId, {
    q: searchParam(request, "q"),
    status: status === "active" || status === "done" ? status : undefined,
    serviceType: serviceType === "camera"
      || serviceType === "electrical"
      || serviceType === "plumbing"
      || serviceType === "mixed"
      ? serviceType
      : undefined,
    urgency: urgency === "attention" || urgency === "overdue"
      ? urgency
      : undefined,
    page: numberParam(request, "page", 1),
    pageSize: numberParam(request, "pageSize", 20),
  }));
}

export async function POST(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await createServiceProject(body as Parameters<typeof createServiceProject>[0]));
}
