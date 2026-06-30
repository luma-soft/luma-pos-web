import { createProject } from "@/lib/actions/extras";
import { getProjectRows } from "@/lib/data/projects";
import { requireMobileManager, requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  return mobileOk({ rows: await getProjectRows() });
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(await createProject(body as Parameters<typeof createProject>[0]));
}
