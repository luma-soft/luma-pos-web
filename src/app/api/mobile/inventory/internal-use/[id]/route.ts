import { inventoryDocumentCapabilities } from "@/lib/inventory/document-capabilities";
import { z } from "zod";
import { deleteInternalUse, updateInternalUse } from "@/lib/actions/internal-use";
import { getInternalUseIssue } from "@/lib/data/internal-use";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return mobileError("errors.invalidData");
  const issue = await getInternalUseIssue(gate.storeId, id);
  return issue ? mobileOk({ ...issue, canApprove: issue.status === "draft" || (issue.status === "pending" && (gate.role === "owner" || gate.role === "manager")), ...inventoryDocumentCapabilities("internal-use", gate.role) }) : mobileError("errors.notFound", 404);
}

export async function PATCH(request: Request, { params }: Context) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return mobileError("errors.invalidData");
  return mobileAction(await updateInternalUse(id, body as Parameters<typeof updateInternalUse>[1]));
}

export async function DELETE(_request: Request, { params }: Context) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  return mobileAction(await deleteInternalUse(id));
}
