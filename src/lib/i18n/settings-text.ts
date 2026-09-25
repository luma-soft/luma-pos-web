import { catalogText } from "./catalog-text";

export function settingsText(
  locale: string,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return catalogText(locale, `settings.${key}`, values);
}

export function settingsTextByFlag(
  isVietnamese: boolean,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return settingsText(isVietnamese ? "vi" : "en", key, values);
}
