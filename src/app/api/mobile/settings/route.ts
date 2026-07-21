import { updateStoreSettings } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStoreSettings } from "@/lib/data/settings";
import { getEInvoiceProviderReadiness } from "@/lib/einvoice/provider";
import { requireMobileManager, requireMobileUser } from "@/lib/mobile/auth";
import { mobileStoreSettingsForRole } from "@/lib/settings/mobile-settings-access";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const settings = await getStoreSettings();
  const visibleSettings = mobileStoreSettingsForRole(settings, gate.role);
  if (gate.role !== "owner" && gate.role !== "manager") {
    return mobileOk(visibleSettings);
  }
  return mobileOk({
    ...visibleSettings,
    integrations: {
      eInvoice: getEInvoiceProviderReadiness(settings.prefs.tax),
    },
  });
}

export async function PATCH(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "settings.sensitive",
    scope: "settings:store",
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(await updateStoreSettings(body));
}
