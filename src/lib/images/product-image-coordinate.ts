import type { PublicMediaConfig } from "@/lib/media/config";

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
  publicMedia: Pick<PublicMediaConfig, "publicBaseUrl">,
): ProductImageCoordinate | null {
  try {
    const configuredBase = new URL(publicMedia.publicBaseUrl);
    if (
      configuredBase.protocol !== "https:"
      || !configuredBase.hostname
      || configuredBase.hostname.endsWith(".")
      || configuredBase.username
      || configuredBase.password
      || configuredBase.port
      || configuredBase.pathname !== "/"
      || configuredBase.search
      || configuredBase.hash
      || configuredBase.origin !== publicMedia.publicBaseUrl
    ) {
      return null;
    }
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.origin !== configuredBase.origin
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }

    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (url.pathname !== `/${path}`) return null;
    const match = IMMUTABLE_PRODUCT_IMAGE_PATH.exec(path);
    if (!match) return null;
    return { storeId: match[1]!, mediaId: match[2]!, path };
  } catch {
    return null;
  }
}
