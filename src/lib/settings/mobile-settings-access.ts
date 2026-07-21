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
  return canReadMobileSettingsAdministration(role) ? notifications : undefined;
}
