import {
  PRODUCT_IMAGE_EXTENSION_BY_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMime,
} from "@/lib/images/product-image-spec";

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
  constructor() {
    super("products.fields.imageUploadError");
    this.name = "ProductImageUploadError";
  }
}

export type UploadedProductImage = {
  url: string;
  path: string;
};

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
  fetcher: typeof fetch = fetch,
): Promise<UploadedProductImage> {
  const uploadFile = normalizedUploadFile(file);
  if (
    !uploadFile ||
    uploadFile.size <= 0 ||
    uploadFile.size > PRODUCT_IMAGE_MAX_BYTES
  ) {
    throw new ProductImageUploadError();
  }

  const form = new FormData();
  form.set("file", uploadFile);

  let response: Response;
  try {
    response = await fetcher("/api/inventory/products/images", {
      method: "POST",
      body: form,
    });
  } catch {
    throw new ProductImageUploadError();
  }

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: { url?: unknown; path?: unknown };
  } | null;
  const url = typeof payload?.data?.url === "string"
    ? payload.data.url.trim()
    : "";
  const path = typeof payload?.data?.path === "string"
    ? payload.data.path.trim()
    : "";
  if (!response.ok || !payload?.ok || !url || !path) {
    throw new ProductImageUploadError();
  }

  return { url, path };
}
