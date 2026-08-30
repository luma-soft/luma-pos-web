import sharp from "sharp";

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
  if (!isSafeRasterMimeType(mimeType)) {
    throw new Error("Unsupported raster media type");
  }

  return new Uint8Array(await sharp(bytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: 64 * 1024 * 1024,
  })
    .rotate()
    .resize({
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer());
}
