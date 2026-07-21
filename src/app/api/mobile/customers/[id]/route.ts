import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { eraseCustomerPersonalData } from "@/lib/customers/privacy";
import { updateCustomerCore } from "@/lib/customers/write";
import { getCustomer } from "@/lib/data/partners";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) return mobileError("errors.notFound", 404);
  return mobileOk(customer);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await updateCustomerCore({
      ...(body as Record<string, unknown>),
      id,
    } as Parameters<typeof updateCustomerCore>[0])
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "customer.erase",
    scope: `customer:${id}:erase`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);
  return mobileAction(await eraseCustomerPersonalData(id));
}
