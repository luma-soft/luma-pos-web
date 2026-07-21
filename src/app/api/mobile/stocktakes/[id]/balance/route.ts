import { balanceStocktake } from "@/lib/actions/stocktakes";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate } from "@/lib/mobile/response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  const { id } = await params;
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "stock.adjust",
    scope: `stocktake:${id}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);
  return mobileAction(await balanceStocktake(id));
}
