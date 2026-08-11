import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { convertHeifToJpeg } from "@/lib/images/heif";
import {
  PRODUCT_IMAGE_EXTENSION_BY_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageMime,
} from "@/lib/images/product-image-spec";

const PRODUCT_IMAGES_BUCKET = "products";

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

export async function uploadProductImage(request: Request) {
  const gate = await requireMobileStockAccess();
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
      ? await convertHeifToJpeg(sourceBytes)
      : sourceBytes;
    const storedExtension = isHeif ? "jpg" : extension;
    const contentType = isHeif ? "image/jpeg" : file.type;
    const path = `stores/${gate.storeId}/products/drafts/${gate.userId}/${Date.now()}-${randomUUID()}.${storedExtension}`;
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, bytes, {
        contentType,
        upsert: false,
      });
    if (error) throw error;
    const { data } = supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(path);
    return mobileOk({ url: data.publicUrl, path });
  } catch (error) {
    console.error("upload_product_image failed:", error);
    return mobileError("products.fields.imageUploadError", 500);
  }
}

export async function deleteProductImage(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  const path = new URL(request.url).searchParams.get("path")?.trim() ?? "";
  const tenantPrefix = `stores/${gate.storeId}/products/`;
  const legacyPrefix = `${gate.userId}/`;
  if ((!path.startsWith(tenantPrefix) && !path.startsWith(legacyPrefix)) || path.includes("..")) {
    return mobileError("errors.forbidden", 403);
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .remove([path]);
    if (error) throw error;
    return mobileOk({ path });
  } catch (error) {
    console.error("delete_product_image failed:", error);
    return mobileError("products.fields.imageUploadError", 500);
  }
}
