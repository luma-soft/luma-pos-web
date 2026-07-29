import { updateNotificationSettingsForUser } from "@/lib/actions/settings";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getStoreSettings } from "@/lib/data/settings";
import { requireMobileManager, requireMobileRole } from "@/lib/mobile/auth";
import { resolveNotificationChannels } from "@/lib/notifications/channels";
import { notificationRoutingPolicyContract } from "@/lib/notifications/routing-policy";
import { notificationSettingsAuthorization } from "@/lib/notifications/settings-authorization";
import {
  MOBILE_SETTINGS_ADMIN_ROLES,
  mobileNotificationSettingsForRole,
} from "@/lib/settings/mobile-settings-access";
import {
  mobileNotificationSettingsPatchSchema,
} from "@/lib/schemas/settings";
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
    routingPolicy: notificationRoutingPolicyContract(),
  });
}

export async function PATCH(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || Object.getPrototypeOf(body) !== Object.prototype
  ) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const parsed = mobileNotificationSettingsPatchSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: notificationSettingsAuthorization.permission,
    scope: notificationSettingsAuthorization.scope,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(
    await updateNotificationSettingsForUser(gate.userId, parsed.data)
  );
}
