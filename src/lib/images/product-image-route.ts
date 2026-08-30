import { requireMobileStockAccess } from "@/lib/mobile/auth";
import {
  mobileAccepted,
  mobileError,
  mobileGate,
  mobileOk,
} from "@/lib/mobile/response";
import { convertHeifToJpeg } from "@/lib/images/heif";
import {
  PRODUCT_IMAGE_EXTENSION_BY_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMime,
} from "@/lib/images/product-image-spec";
import { getMediaService, mediaServiceError } from "@/lib/media/service";

type ProductImageRouteDependencies = {
  authenticate?: typeof requireMobileStockAccess;
  mediaService?: Pick<
    ReturnType<typeof getMediaService>,
    "putManagedObject" | "deleteMedia"
  >;
  convertHeif?: typeof convertHeifToJpeg;
  legacyPublicBaseUrl?: string;
};

const PRODUCT_IMAGES_BUCKET = "products";
const LEGACY_PRODUCT_STORAGE_PREFIX =
  `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;

function trustedLegacyCoordinate(
  value: string,
  configuredBaseUrl: string,
): { path: string } | null {
  try {
    const configured = new URL(configuredBaseUrl);
    const url = new URL(value);
    if (
      configured.protocol !== "https:"
      || configured.pathname !== "/"
      || configured.username
      || configured.password
      || configured.port
      || configured.search
      || configured.hash
      || configured.hostname.endsWith(".")
      || url.origin !== configured.origin
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || !url.pathname.startsWith(LEGACY_PRODUCT_STORAGE_PREFIX)
    ) return null;
    const path = decodeURIComponent(
      url.pathname.slice(LEGACY_PRODUCT_STORAGE_PREFIX.length),
    );
    return path && !path.includes("..") ? { path } : null;
  } catch {
    return null;
  }
}

function sniffImageMime(bytes: Uint8Array): ProductImageMime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) {
      return "image/heic";
    }
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

export async function uploadProductImage(
  request: Request,
  dependencies: ProductImageRouteDependencies = {},
) {
  const gate = await (dependencies.authenticate ?? requireMobileStockAccess)();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError("errors.invalidData", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return mobileError("errors.invalidData", 400);
  }
  if (file.size <= 0 || file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return mobileError("products.fields.imageUploadError", 400);
  }
  const extension = PRODUCT_IMAGE_EXTENSION_BY_MIME[file.type as ProductImageMime];
  if (!extension) {
    return mobileError("products.fields.imageUploadError", 400);
  }

  const sourceBytes = Buffer.from(await file.arrayBuffer());
  if (sniffImageMime(sourceBytes.subarray(0, 16)) !== file.type) {
    return mobileError("products.fields.imageUploadError", 400);
  }

  try {
    const isHeif = extension === "heic" || extension === "heif";
    const bytes = isHeif
      ? await (dependencies.convertHeif ?? convertHeifToJpeg)(sourceBytes)
      : sourceBytes;
    const contentType = isHeif ? "image/jpeg" : file.type;
    const fileName = isHeif
      ? `${file.name.replace(/\.[^.]+$/, "")}.jpg`
      : file.name;
    const result = await (dependencies.mediaService ?? getMediaService())
      .putManagedObject(gate, {
      purpose: "product-image",
      targetId: gate.storeId,
      fileName,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
    }, bytes);
    return mobileOk(result);
  } catch (error) {
    console.error("upload_product_image failed:", error);
    const mapped = mediaServiceError(error);
    return mobileError(
      mapped.status >= 500 ? "products.fields.imageUploadError" : mapped.error,
      mapped.status,
    );
  }
}

export async function deleteProductImage(
  request: Request,
  dependencies: ProductImageRouteDependencies = {},
) {
  const gate = await (dependencies.authenticate ?? requireMobileStockAccess)();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  const params = new URL(request.url).searchParams;
  const mediaId = params.get("mediaId")?.trim() ?? "";
  if (mediaId) {
    try {
      const result = await (dependencies.mediaService ?? getMediaService())
        .deleteMedia(gate, mediaId);
      return mobileOk({ mediaId: result.id, status: result.status });
    } catch (error) {
      const mapped = mediaServiceError(error);
      return mobileError(mapped.error, mapped.status);
    }
  }

  const path = params.get("path")?.trim() ?? "";
  const legacyUrl = params.get("url")?.trim() ?? "";
  const coordinate = trustedLegacyCoordinate(
    legacyUrl,
    dependencies.legacyPublicBaseUrl
      ?? process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? "",
  );
  const tenantPrefix = `stores/${gate.storeId}/products/drafts/${gate.userId}/`;
  const legacyPrefix = `${gate.userId}/`;
  if (
    !coordinate
    || coordinate.path !== path
    || (!path.startsWith(tenantPrefix) && !path.startsWith(legacyPrefix))
    || path.includes("..")
  ) {
    return mobileError("errors.forbidden", 403);
  }
  // Legacy rows have no durable upload-session claim. Physical deletion here
  // would race product writers and cannot safely distinguish shared references
  // whose URLs use an equivalent spelling. Product save removes the DB
  // reference; migration/cleanup owns eventual object reclamation.
  return mobileAccepted({ path, status: "deferred" as const });
}
