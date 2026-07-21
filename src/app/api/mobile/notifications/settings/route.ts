import { updateStorePrefsForUser } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileManager, requireMobileRole } from "@/lib/mobile/auth";
import { resolveNotificationChannels } from "@/lib/notifications/channels";
import { notificationSettingsAuthorization } from "@/lib/notifications/settings-authorization";
import { MOBILE_SETTINGS_ADMIN_ROLES } from "@/lib/settings/mobile-settings-access";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileRole(MOBILE_SETTINGS_ADMIN_ROLES);
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const store = await getStoreSettings();
  const channels = store.prefs.notifications.channels;
  return mobileOk({
    ...store.prefs.notifications,
    channels,
    availableChannels: resolveNotificationChannels(),
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
    permission: notificationSettingsAuthorization.permission,
    scope: notificationSettingsAuthorization.scope,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(
    await updateStorePrefsForUser(gate.userId, {
      notifications: body as Parameters<typeof updateStorePrefsForUser>[1]["notifications"],
    })
  );
}
