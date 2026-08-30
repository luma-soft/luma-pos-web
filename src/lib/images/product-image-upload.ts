import {
  PRODUCT_IMAGE_EXTENSION_BY_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMime,
} from "@/lib/images/product-image-spec";
import { parseProductImagePublicUrl } from "@/lib/images/product-image-coordinate";
import { uploadManagedMedia } from "@/lib/media/client";

export {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
} from "@/lib/images/product-image-spec";

const MIME_BY_EXTENSION: Record<string, ProductImageMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};
export class ProductImageUploadError extends Error {
  constructor(message = "products.fields.imageUploadError") {
    super(message);
    this.name = "ProductImageUploadError";
  }
}

export type UploadedProductImage = {
  mediaId: string;
  url: string;
  path: string;
};

export type ProductImageUploadBatch = {
  completed: UploadedProductImage[];
  remaining: File[];
  error?: string;
};

type ProductImageUploader = (
  file: File,
  targetId: string,
) => Promise<UploadedProductImage>;

function normalizedUploadFile(file: File): File | null {
  const declaredMime = file.type === "image/jpg" ? "image/jpeg" : file.type;
  const inferredMime = MIME_BY_EXTENSION[
    file.name.split(".").at(-1)?.toLowerCase() ?? ""
  ];
  const mime = (declaredMime || inferredMime) as ProductImageMime | undefined;
  if (!mime || !(mime in PRODUCT_IMAGE_EXTENSION_BY_MIME)) return null;
  if (mime === file.type) return file;
  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified,
  });
}

export async function uploadProductImageFile(
  file: File,
  targetId: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<UploadedProductImage> {
  const uploadFile = normalizedUploadFile(file);
  if (
    !uploadFile ||
    uploadFile.size <= 0 ||
    uploadFile.size > PRODUCT_IMAGE_MAX_BYTES
  ) {
    throw new ProductImageUploadError();
  }

  try {
    const usesConversionBridge = uploadFile.type === "image/heic"
      || uploadFile.type === "image/heif";
    let reportedPath: string | undefined;
    const media = usesConversionBridge
      ? await (async () => {
          const form = new FormData();
          form.set("file", uploadFile);
          const response = await fetcher("/api/inventory/products/images", {
            method: "POST",
            body: form,
          });
          const payload = await response.json() as {
            data?: { mediaId?: unknown; url?: unknown; path?: unknown };
            error?: unknown;
          };
          const id = typeof payload.data?.mediaId === "string"
            ? payload.data.mediaId
            : "";
          const url = typeof payload.data?.url === "string"
            ? payload.data.url
            : "";
          reportedPath = typeof payload.data?.path === "string"
            ? payload.data.path
            : "";
          if (!response.ok || !id || !url || !reportedPath) {
            throw new ProductImageUploadError(
              typeof payload.error === "string" ? payload.error : undefined,
            );
          }
          return { id, url, visibility: "public" as const };
        })()
      : await uploadManagedMedia(
          uploadFile,
          { purpose: "product-image", targetId },
          fetcher,
          now,
        );
    const coordinate = parseProductImagePublicUrl(media.url);
    if (
      media.visibility !== "public"
      || !coordinate
      || coordinate.storeId !== targetId
      || coordinate.mediaId !== media.id
      || (reportedPath !== undefined && reportedPath !== coordinate.path)
    ) {
      throw new ProductImageUploadError();
    }
    return { mediaId: media.id, url: media.url, path: coordinate.path };
  } catch (error) {
    if (error instanceof ProductImageUploadError) throw error;
    const message = error instanceof Error && error.message
      ? error.message
      : undefined;
    throw new ProductImageUploadError(message);
  }
}

export async function uploadProductImageFiles(input: {
  completed: readonly UploadedProductImage[];
  drafts: readonly File[];
  targetId: string;
  upload?: ProductImageUploader;
}): Promise<ProductImageUploadBatch> {
  const completed = [...input.completed];
  const upload = input.upload ?? uploadProductImageFile;
  for (let index = 0; index < input.drafts.length; index += 1) {
    try {
      completed.push(await upload(input.drafts[index]!, input.targetId));
    } catch (error) {
      return {
        completed,
        remaining: input.drafts.slice(index),
        error: error instanceof Error && error.message
          ? error.message
          : "products.fields.imageUploadError",
      };
    }
  }
  return { completed, remaining: [] };
}

export async function deleteUploadedProductImage(
  image: Pick<UploadedProductImage, "mediaId" | "path">,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const query = new URLSearchParams({
    mediaId: image.mediaId,
    path: image.path,
  });
  try {
    const response = await fetcher(`/api/inventory/products/images?${query}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new ProductImageUploadError();
  } catch (error) {
    if (error instanceof ProductImageUploadError) throw error;
    throw new ProductImageUploadError();
  }
}

const LEGACY_PRODUCT_STORAGE_PREFIX =
  "/storage/v1/object/public/products/";

export async function deleteLegacyProductImageUrl(
  imageUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  let path = "";
  try {
    const url = new URL(imageUrl);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || !url.pathname.startsWith(LEGACY_PRODUCT_STORAGE_PREFIX)
    ) {
      return false;
    }
    path = decodeURIComponent(
      url.pathname.slice(LEGACY_PRODUCT_STORAGE_PREFIX.length),
    );
    if (!path || path.includes("..")) return false;
  } catch {
    return false;
  }

  try {
    const response = await fetcher(
      `/api/inventory/products/images?${new URLSearchParams({ path })}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new ProductImageUploadError();
    return true;
  } catch (error) {
    if (error instanceof ProductImageUploadError) throw error;
    throw new ProductImageUploadError();
  }
}
