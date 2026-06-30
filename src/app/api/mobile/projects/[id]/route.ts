import { updateProject } from "@/lib/actions/extras";
import { getProjectDetail } from "@/lib/data/projects";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const detail = await getProjectDetail(id);
  if (!detail) return mobileError("errors.notFound", 404);
  return mobileOk(detail);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  return mobileAction(await updateProject({ ...(body as Record<string, unknown>), id } as Parameters<typeof updateProject>[0]));
}
