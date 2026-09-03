import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";

/** Format the wall time recorded in the file without inventing its time zone. */
export function formatSourceTimestamp(value: string | undefined, locale: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00", zone] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hour)
    || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) return null;
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  return {
    text: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium", ...(match[4] ? { timeStyle: "medium" as const } : {}), timeZone: "UTC",
    }).format(date),
    timezone: zone ? (zone === "Z" ? "UTC" : `UTC${zone}`) : null,
  };
}

export function formatFileInfoBytes(value: number, locale: string) {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  const index = bytes > 0 ? Math.max(0, Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}

export function hasFileCoordinates(metadata: MediaFileMetadata | null | undefined) {
  return typeof metadata?.latitude === "number" && Number.isFinite(metadata.latitude)
    && Math.abs(metadata.latitude) <= 90 && typeof metadata.longitude === "number"
    && Number.isFinite(metadata.longitude) && Math.abs(metadata.longitude) <= 180;
}

export function canExtractFileMetadata(metadata: MediaFileMetadata | null | undefined) {
  return !metadata || metadata.status === "failed";
}
