import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  getSharedPosDrafts,
  sharedPosDraftSyncSchema,
  syncSharedPosDrafts,
} from "@/lib/pos/shared-drafts";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  const drafts = await getSharedPosDrafts(gate.storeId, gate.principalId ?? gate.userId);
  return mobileOk({ drafts });
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  const body = await readJson(request);
  const parsed = sharedPosDraftSyncSchema.safeParse(body);
  if (!parsed.success) return mobileError("errors.invalidData", 400);

  const drafts = await syncSharedPosDrafts(
    gate.storeId,
    gate.principalId ?? gate.userId,
    gate.userId,
    parsed.data,
  );
  return mobileOk({ drafts });
}
