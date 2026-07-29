import { db } from "@/db";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";
import { mobileFieldOperation } from "@/lib/services/field-api";
import { checkInServiceVisitCore } from "@/lib/services/field-operations";
import { serviceVisitMutationSchema } from "@/lib/services/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileAction(gate);
  const body = await readJson(request);
  const { id } = await params;
  const parsed = serviceVisitMutationSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    jobId: id,
  });
  if (!parsed.success) return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileFieldOperation(() => db.transaction((tx) =>
    checkInServiceVisitCore(tx, { userId: gate.userId, role: gate.role }, parsed.data)
  ));
}
