import { db } from "@/db";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";
import { mobileFieldOperation } from "@/lib/services/field-api";
import { updateFieldChecklistCore } from "@/lib/services/field-operations";
import { serviceChecklistUpdateSchema } from "@/lib/services/schemas";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileAction(gate);
  const body = await readJson(request);
  const { id } = await params;
  const parsed = serviceChecklistUpdateSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    jobId: id,
  });
  if (!parsed.success) return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileFieldOperation(() => db.transaction((tx) =>
    updateFieldChecklistCore(tx, { userId: gate.userId, role: gate.role }, parsed.data)
  ));
}
