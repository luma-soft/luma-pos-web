import { mergeTablesForUser } from "@/lib/actions/tables";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const input = body as Record<string, unknown>;
  const targetId = typeof input.targetId === "string" ? input.targetId : "";
  const sourceIds = Array.isArray(input.sourceIds) ? input.sourceIds : [];
  return mobileAction(await mergeTablesForUser(targetId, sourceIds));
}
