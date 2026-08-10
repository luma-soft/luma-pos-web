import { requireMobileAiUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate } from "@/lib/mobile/response";

export async function POST() {
  const gate = await requireMobileAiUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  return mobileError("ai.actions.unsupported", 410);
}
