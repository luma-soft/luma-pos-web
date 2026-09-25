import enMessages from "../../../messages/en.json";
import viMessages from "../../../messages/vi.json";

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = {
  en: enMessages as Catalog,
  vi: viMessages as Catalog,
};

function lookup(locale: string, key: string): string {
  let value: unknown = catalogs[locale === "vi" ? "vi" : "en"];
  for (const segment of key.split(".")) {
    if (!value || typeof value !== "object" || !(segment in value)) return key;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === "string" ? value : key;
}

export function catalogText(
  locale: string,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
    lookup(locale, key),
  );
}

export function catalogTextByFlag(
  isVietnamese: boolean,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return catalogText(isVietnamese ? "vi" : "en", key, values);
}

export function legacyText(
  locale: string,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return catalogText(locale, `legacy.${key}`, values);
}

export function legacyTextByFlag(
  isVietnamese: boolean,
  key: string,
  values: Record<string, string | number> = {},
): string {
  return catalogTextByFlag(isVietnamese, `legacy.${key}`, values);
}
