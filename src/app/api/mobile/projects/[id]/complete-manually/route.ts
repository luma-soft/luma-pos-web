import { completeServiceProjectManually } from "@/lib/actions/extras";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileAction, mobileGate } from "@/lib/mobile/response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  return mobileAction(await completeServiceProjectManually({ id }));
}
