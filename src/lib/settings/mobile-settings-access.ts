import type { Role } from "@/lib/actions/common";
import type { StoreSettings } from "@/lib/data/settings";
import type { StorePrefs } from "@/lib/schemas/settings";

export const MOBILE_SETTINGS_ADMIN_ROLES = [
  "owner",
  "manager",
] as const satisfies readonly Role[];

export const MOBILE_AI_ADMIN_ROLES = [
  "owner",
] as const satisfies readonly Role[];

export function canReadMobileSettingsAdministration(role: Role) {
  return MOBILE_SETTINGS_ADMIN_ROLES.some(
    (administrativeRole) => administrativeRole === role,
  );
}

export function canReadMobileAiAdministration(role: Role) {
  return MOBILE_AI_ADMIN_ROLES.some((administrativeRole) => administrativeRole === role);
}

export function mobileStoreSettingsForRole(
  settings: StoreSettings,
  role: Role,
) {
  if (canReadMobileSettingsAdministration(role)) return settings;

  return {
    name: settings.name,
    industry: settings.industry,
    currency: settings.currency,
    locale: settings.locale,
  };
}

export function mobileAiSettingsForRole(
  ai: StorePrefs["ai"],
  role: Role,
) {
  if (role === "owner") return ai;
  return { configured: ai.openaiApiKeySet };
}

export function mobileNotificationSettingsForRole(
  notifications: StorePrefs["notifications"],
  role: Role,
) {
  if (!canReadMobileSettingsAdministration(role)) return undefined;

  return {
    ...notifications,
    channels: { ...notifications.channels },
    quietHours: { ...notifications.quietHours },
    thresholds: { ...notifications.thresholds },
    roleRouting: Object.fromEntries(
      Object.entries(notifications.roleRouting).map(([category, roles]) => [
        category,
        [...roles],
      ]),
    ) as StorePrefs["notifications"]["roleRouting"],
  };
}

function mergeDefined<T extends object>(current: T, patch?: Partial<T>): T {
  if (!patch) return { ...current };
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  };
}

export function mergeMobileNotificationSettings(
  current: StorePrefs["notifications"],
  patch: Omit<
    Partial<StorePrefs["notifications"]>,
    "channels" | "quietHours" | "thresholds" | "roleRouting"
  > & {
    channels?: Partial<StorePrefs["notifications"]["channels"]>;
    quietHours?: Partial<StorePrefs["notifications"]["quietHours"]>;
    thresholds?: Partial<StorePrefs["notifications"]["thresholds"]>;
    roleRouting?: Partial<StorePrefs["notifications"]["roleRouting"]>;
  },
): StorePrefs["notifications"] {
  return {
    ...current,
    ...patch,
    channels: mergeDefined(current.channels, patch.channels),
    quietHours: mergeDefined(current.quietHours, patch.quietHours),
    thresholds: mergeDefined(current.thresholds, patch.thresholds),
    roleRouting: mergeDefined(current.roleRouting, patch.roleRouting),
  };
}
