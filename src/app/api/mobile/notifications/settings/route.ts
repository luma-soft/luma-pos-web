import { updateStorePrefsForUser } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileManager, requireMobileRole } from "@/lib/mobile/auth";
import { resolveNotificationChannels } from "@/lib/notifications/channels";
import { notificationSettingsAuthorization } from "@/lib/notifications/settings-authorization";
import {
  mergeMobileNotificationSettings,
  MOBILE_SETTINGS_ADMIN_ROLES,
  mobileNotificationSettingsForRole,
} from "@/lib/settings/mobile-settings-access";
import type { StorePrefs } from "@/lib/schemas/settings";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileRole(MOBILE_SETTINGS_ADMIN_ROLES);
  if (!gate.ok) return mobileGate(gate)!;

  const store = await getStoreSettings();
  const settings = mobileNotificationSettingsForRole(
    store.prefs.notifications,
    gate.role,
  )!;
  return mobileOk({
    ...settings,
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

  const current = (await getStoreSettings()).prefs.notifications;
  const notifications = mergeMobileNotificationSettings(
    current,
    body as Parameters<typeof mergeMobileNotificationSettings>[1],
  );
  return mobileAction(
    await updateStorePrefsForUser(gate.userId, {
      notifications: notifications as StorePrefs["notifications"],
    })
  );
}
