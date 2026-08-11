export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const PRODUCT_IMAGE_EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
} as const;

export type ProductImageMime = keyof typeof PRODUCT_IMAGE_EXTENSION_BY_MIME;

export const PRODUCT_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
