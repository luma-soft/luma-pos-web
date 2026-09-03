import { deleteInstalledAsset } from "@/lib/actions/services";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { assetId } = await params;
  return mobileAction(await deleteInstalledAsset(assetId));
}
