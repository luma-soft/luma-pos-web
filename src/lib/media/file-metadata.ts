import { join } from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import mediaInfoFactory, { type MediaInfoResult } from "mediainfo.js";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";

export const METADATA_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const METADATA_VIDEO_READ_MAX_BYTES = 16 * 1024 * 1024;
export const METADATA_TIMEOUT_MS = 15_000;
type Fields = Omit<MediaFileMetadata, "version" | "status" | "extractedAt">;
export type MetadataReader = (size: number, offset: number, signal: AbortSignal) => Promise<Uint8Array>;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || undefined;
}

function number(value: unknown, min: number, max: number): number | undefined {
  const result = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined;
}

/** Preserve wall time and the recorded offset. Missing time zones stay missing. */
export function normalizeMetadataDate(value: unknown, offset?: unknown): string | undefined {
  const recorded = text(value);
  const source = recorded?.replace(/^UTC\s+/, "").replace(/\s+UTC$/, "Z");
  if (!source) return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(source);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction = "", sourceZone] = match;
  const calendar = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (+year < 1901 || +year > 2200 || calendar.getUTCFullYear() !== +year
    || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day
    || +hour > 23 || +minute > 59 || +second > 59) return undefined;
  const candidateZone = sourceZone ?? (recorded?.startsWith("UTC ") ? "Z" : text(offset));
  let zone = "";
  if (candidateZone === "Z") zone = "Z";
  else if (candidateZone) {
    const parts = /^([+-])(\d{2}):?(\d{2})$/.exec(candidateZone);
    if (parts && +parts[2] <= 14 && +parts[3] <= 59 && (+parts[2] < 14 || +parts[3] === 0)) {
      zone = `${parts[1]}${parts[2]}:${parts[3]}`;
    } else if (sourceZone) return undefined;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`;
}

function clean(fields: Fields): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function metadataFromExif(tags: Record<string, unknown>): Fields {
  const latitude = number(tags.latitude, -90, 90);
  const longitude = number(tags.longitude, -180, 180);
  const hasLocation = latitude !== undefined && longitude !== undefined;
  const altitude = number(tags.GPSAltitude, 0, 100_000);
  return clean({
    capturedAt: normalizeMetadataDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal),
    fileCreatedAt: normalizeMetadataDate(tags.CreateDate, tags.OffsetTimeDigitized),
    fileModifiedAt: normalizeMetadataDate(tags.ModifyDate, tags.OffsetTime),
    latitude: hasLocation ? latitude : undefined,
    longitude: hasLocation ? longitude : undefined,
    altitude: hasLocation && altitude !== undefined ? (tags.GPSAltitudeRef === 1 ? -altitude : altitude) : undefined,
    make: text(tags.Make), model: text(tags.Model), lens: text(tags.LensModel), software: text(tags.Software),
    width: number(tags.ExifImageWidth ?? tags.ImageWidth, 1, 100_000),
    height: number(tags.ExifImageHeight ?? tags.ImageHeight, 1, 100_000),
    orientation: number(tags.Orientation, 1, 8),
    iso: number(tags.ISO, 1, 10_000_000), fNumber: number(tags.FNumber, 0.1, 1024),
    exposureTime: number(tags.ExposureTime, 0.0000001, 86400), focalLength: number(tags.FocalLength, 0.01, 100_000),
  });
}

export function parseRecordedLocation(value: unknown): Pick<Fields, "latitude" | "longitude" | "altitude"> {
  const location = text(value);
  if (!location) return {};
  const iso = /^([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?$/.exec(location);
  const degrees = /^(\d+(?:\.\d+)?)°([NS])\s+(\d+(?:\.\d+)?)°([EW])(?:\s+([+-]?\d+(?:\.\d+)?)m)?$/.exec(location);
  const latitude = number(iso ? iso[1] : degrees ? +degrees[1] * (degrees[2] === "S" ? -1 : 1) : undefined, -90, 90);
  const longitude = number(iso ? iso[2] : degrees ? +degrees[3] * (degrees[4] === "W" ? -1 : 1) : undefined, -180, 180);
  if (latitude === undefined || longitude === undefined) return {};
  return clean({ latitude, longitude, altitude: number(iso?.[3] ?? degrees?.[5], -20_000, 100_000) });
}

export function metadataFromVideo(result: MediaInfoResult): Fields {
  const tracks = result.media?.track ?? [];
  const general = tracks.find((track) => track["@type"] === "General");
  const video = tracks.find((track) => track["@type"] === "Video");
  const audio = tracks.find((track) => track["@type"] === "Audio");
  if (!general || !video) return {};
  return clean({
    capturedAt: normalizeMetadataDate(general.Recorded_Date),
    // Container creation/tagging is not evidence of when the scene was captured.
    fileCreatedAt: normalizeMetadataDate(general.Encoded_Date),
    fileModifiedAt: normalizeMetadataDate(general.Tagged_Date),
    ...parseRecordedLocation(general.Recorded_Location),
    make: text(general.Encoded_Hardware_CompanyName), model: text(general.Encoded_Hardware_Name),
    software: text(general.Encoded_Application), format: text(general.Format),
    width: number(video.Width, 1, 100_000), height: number(video.Height, 1, 100_000),
    durationSeconds: number(general.Duration ?? video.Duration, 0, 31_536_000),
    frameRate: number(video.FrameRate, 0.001, 100_000),
    videoCodec: text(video.Format), audioCodec: text(audio?.Format),
  });
}

const exifOptions = {
  translateValues: false, reviveValues: false, xmp: false, icc: false, iptc: false,
  pick: ["DateTimeOriginal", "OffsetTimeOriginal", "CreateDate", "OffsetTimeDigitized", "ModifyDate", "OffsetTime",
    "Make", "Model", "LensModel", "Software", "ExifImageWidth", "ExifImageHeight", "ImageWidth", "ImageHeight", "Orientation",
    "GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef", "GPSAltitude", "GPSAltitudeRef",
    "ISO", "FNumber", "ExposureTime", "FocalLength"],
};

export async function extractFileMetadata(input: {
  mimeType: string; sizeBytes: number; read: MetadataReader; now?: () => Date;
}): Promise<MediaFileMetadata> {
  const base = { version: 1 as const, extractedAt: (input.now?.() ?? new Date()).toISOString() };
  const isImage = input.mimeType.startsWith("image/");
  const isVideo = input.mimeType.startsWith("video/");
  if (!isImage && !isVideo) return { ...base, status: "unsupported" };
  const controller = new AbortController();
  const deadline = Date.now() + METADATA_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  let readBytes = 0;
  let readCount = 0;
  const maxRead = isImage ? METADATA_IMAGE_MAX_BYTES : METADATA_VIDEO_READ_MAX_BYTES;
  const read = async (size: number, offset: number) => {
    if (Date.now() >= deadline || controller.signal.aborted || ++readCount > 128
      || !Number.isSafeInteger(size) || !Number.isSafeInteger(offset) || size < 1 || offset < 0 || offset >= input.sizeBytes) {
      throw new Error("Metadata read budget exceeded");
    }
    const length = Math.min(size, input.sizeBytes - offset);
    readBytes += length;
    if (readBytes > maxRead) throw new Error("Metadata byte budget exceeded");
    const bytes = await input.read(length, offset, controller.signal);
    if (bytes.byteLength !== length) throw new Error("Metadata range response mismatch");
    return bytes;
  };
  try {
    let fields: Fields;
    if (isImage) {
      const bytes = await read(input.sizeBytes, 0);
      const image = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata().catch(() => null);
      const tags = await exifr.parse(bytes, exifOptions).catch(() => undefined)
        ?? (image?.exif ? await exifr.parse(image.exif, exifOptions).catch(() => undefined) : undefined);
      if (!image && !tags) return { ...base, status: "failed" };
      fields = clean({ ...metadataFromExif(tags ?? {}),
        ...(image ? { width: image.width, height: image.height, orientation: image.orientation, format: image.format } : {}),
      });
    } else {
      const parser = await mediaInfoFactory({
        format: "object", full: false, coverData: false, chunkSize: 256 * 1024,
        // Included explicitly in the server trace. Do not import/require the WASM
        // as a JS module: Turbopack would try to resolve its native imports.
        locateFile: () => join(process.cwd(), "node_modules/mediainfo.js/dist/MediaInfoModule.wasm"),
      });
      try { fields = metadataFromVideo(await parser.analyzeData(input.sizeBytes, read)); }
      finally { parser.close(); }
    }
    return { ...base, status: Object.keys(fields).length ? "ready" : "empty", ...fields };
  } catch {
    // Extraction never makes a successfully stored original unusable. No GPS/tags in logs.
    return { ...base, status: "failed" };
  } finally { clearTimeout(timer); }
}
