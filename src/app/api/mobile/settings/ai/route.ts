import { updateAiSettings } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileOwner, requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { mobileAiSettingsForRole } from "@/lib/settings/mobile-settings-access";

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const settings = await getStoreSettings();
  return mobileOk(mobileAiSettingsForRole(settings.prefs.ai, gate.role));
}

export async function PATCH(request: Request) {
  const gate = await requireMobileOwner();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  if (!body) return mobileError("errors.invalidData");
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: "settings:ai",
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);
  return mobileAction(await updateAiSettings(body));
}
