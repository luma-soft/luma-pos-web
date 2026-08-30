export const PRODUCT_MEDIA_PUBLIC_ORIGIN = "https://media.lumapos.vn";
const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMMUTABLE_PRODUCT_IMAGE_PATH = new RegExp(
  `^stores/(${UUID_SEGMENT})/products/\\d{4}/(?:0[1-9]|1[0-2])/(${UUID_SEGMENT})/original\\.(?:jpg|png|webp)$`,
  "i",
);

export type ProductImageCoordinate = {
  storeId: string;
  mediaId: string;
  path: string;
};

export function parseProductImagePublicUrl(
  value: string,
): ProductImageCoordinate | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.origin !== PRODUCT_MEDIA_PUBLIC_ORIGIN
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }

    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const match = IMMUTABLE_PRODUCT_IMAGE_PATH.exec(path);
    if (!match) return null;
    return { storeId: match[1]!, mediaId: match[2]!, path };
  } catch {
    return null;
  }
}
