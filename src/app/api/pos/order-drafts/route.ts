import { NextResponse } from "next/server";
import { UnauthorizedError, requireStoreContext } from "@/lib/auth/store-context";
import { revalidateAppDataPage as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { Routes } from "@/lib/routes";
import {
  deletePOSOrderDraft,
  listPOSOrderDrafts,
  posOrderDraftRequestSchema,
  savePOSOrderDraft,
} from "@/lib/orders/pos-drafts";

const noStore = { "Cache-Control": "private, no-store" };

function draftErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401, headers: noStore });
  }
  if (error instanceof Error && error.message === "POS_DRAFT_FINALIZED") {
    return NextResponse.json({ ok: false, error: "pos.errors.draftAlreadyFinalized" }, { status: 409, headers: noStore });
  }
  if (error instanceof Error && error.message === "POS_DRAFT_INVALID") {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400, headers: noStore });
  }
  throw error;
}

export async function GET() {
  try {
    const context = await requireStoreContext();
    const drafts = await listPOSOrderDrafts(context.storeId, context.userId, context.userId);
    return NextResponse.json({ drafts }, { headers: noStore });
  } catch (error) {
    return draftErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireStoreContext();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400, headers: noStore });
    }
    const parsed = posOrderDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400, headers: noStore });
    }
    const draft = parsed.data.action === "save"
      ? await savePOSOrderDraft(context.storeId, context.userId, context.userId, parsed.data.draftId, parsed.data.payload)
      : await deletePOSOrderDraft(context.storeId, context.userId, context.userId, parsed.data.draftId);
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
    return NextResponse.json({ draft }, { headers: noStore });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
