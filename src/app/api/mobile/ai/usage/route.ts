import { getAiUsageStatus } from "@/lib/ai/usage";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { requireMobileRole } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";
import { MOBILE_AI_ADMIN_ROLES } from "@/lib/settings/mobile-settings-access";

export async function GET() {
  const gate = await requireMobileRole(MOBILE_AI_ADMIN_ROLES);
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;
  return mobileOk(await getAiUsageStatus());
}
