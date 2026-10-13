import decodeHeic from "heic-decode";
import sharp from "sharp";

const MAX_THUMBNAIL_PIXELS = 64 * 1024 * 1024;

const SAFE_RASTER_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isSafeRasterMimeType(mimeType: string): boolean {
  return SAFE_RASTER_MEDIA_TYPES.has(mimeType.trim().toLowerCase());
}

export async function createMediaBrowserPreview(
  bytes: Uint8Array,
  mimeType: string,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<Uint8Array> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const maxDimension = options.maxDimension ?? 2560;
  const quality = options.quality ?? 84;
  if (!isSafeRasterMimeType(normalizedMimeType)) {
    throw new Error("Unsupported raster media type");
  }
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1 || maxDimension > 4096) {
    throw new Error("Invalid media preview dimensions");
  }
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("Invalid media preview quality");
  }

  const heic = normalizedMimeType === "image/heic"
    || normalizedMimeType === "image/heif";
  const image = heic
    ? await (async () => {
        const decoded = await decodeHeic({ buffer: bytes });
        const pixels = decoded.width * decoded.height;
        if (!Number.isSafeInteger(pixels) || pixels <= 0
            || pixels > MAX_THUMBNAIL_PIXELS
            || decoded.data.byteLength !== pixels * 4) {
          throw new Error("Invalid HEIC dimensions");
        }
        return sharp(Buffer.from(
          decoded.data.buffer,
          decoded.data.byteOffset,
          decoded.data.byteLength,
        ), {
          raw: { width: decoded.width, height: decoded.height, channels: 4 },
          limitInputPixels: MAX_THUMBNAIL_PIXELS,
        });
      })()
    : sharp(bytes, {
        animated: false,
        failOn: "warning",
        limitInputPixels: MAX_THUMBNAIL_PIXELS,
      }).rotate();

  return new Uint8Array(await image
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer());
}

export function createMediaThumbnail(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  return createMediaBrowserPreview(bytes, mimeType, {
    maxDimension: 640,
    quality: 78,
  });
}
