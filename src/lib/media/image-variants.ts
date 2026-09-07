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

export async function createMediaThumbnail(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (!isSafeRasterMimeType(normalizedMimeType)) {
    throw new Error("Unsupported raster media type");
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
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer());
}
