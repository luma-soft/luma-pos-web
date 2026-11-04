import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { revalidateAppDataPage as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { Routes } from "@/lib/routes";
import {
  deletePOSOrderDraft,
  listPOSOrderDrafts,
  posOrderDraftRequestSchema,
  savePOSOrderDraft,
} from "@/lib/orders/pos-drafts";

function mobileDraftError(error: unknown) {
  if (error instanceof Error && error.message === "POS_DRAFT_FINALIZED") {
    return mobileError("pos.errors.draftAlreadyFinalized", 409);
  }
  if (error instanceof Error && error.message === "POS_DRAFT_INVALID") {
    return mobileError("errors.invalidData", 400);
  }
  throw error;
}

export async function GET() {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  try {
    const drafts = await listPOSOrderDrafts(gate.storeId, gate.principalId ?? gate.userId, gate.userId);
    return mobileOk({ drafts });
  } catch (error) {
    return mobileDraftError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate);
  const parsed = posOrderDraftRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  try {
    const ownerUserId = gate.principalId ?? gate.userId;
    const draft = parsed.data.action === "save"
      ? await savePOSOrderDraft(gate.storeId, ownerUserId, gate.userId, parsed.data.draftId, parsed.data.payload)
      : await deletePOSOrderDraft(gate.storeId, ownerUserId, gate.userId, parsed.data.draftId);
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
    return mobileOk({ draft });
  } catch (error) {
    return mobileDraftError(error);
  }
}
