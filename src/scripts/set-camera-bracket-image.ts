import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const SKU = "MAT-CAM-BRACKET-IP";
const STORAGE_PATH =
  "catalog-2026-07/camera-ip-bracket-wall-base-v2.png";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error(
      "Cách dùng: bun run src/scripts/set-camera-bracket-image.ts <đường-dẫn-ảnh.png>",
    );
  }

  const image = await readFile(imagePath);
  const isPng = PNG_SIGNATURE.every((byte, index) => image[index] === byte);
  if (!isPng) throw new Error("Ảnh chân đế phải là file PNG hợp lệ");

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.sku, SKU))
    .limit(1);
  if (!product) throw new Error(`Không tìm thấy sản phẩm ${SKU}`);

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("products")
    .upload(STORAGE_PATH, image, {
      contentType: "image/png",
      upsert: true,
    });
  if (error) throw new Error(`Không tải được ảnh lên Storage: ${error.message}`);

  const { data } = supabase.storage
    .from("products")
    .getPublicUrl(STORAGE_PATH);
  const [updated] = await db
    .update(products)
    .set({
      name: "Chân đế chữ L",
      fullName: "Chân đế chữ L",
      description:
        "Chân đế chữ L bằng nhựa, dùng gắn camera Wi‑Fi lên tường hoặc trần.",
      imageUrls: [data.publicUrl],
      updatedAt: sql`now()`,
    })
    .where(eq(products.id, product.id))
    .returning({ sku: products.sku, imageUrls: products.imageUrls });
  if (!updated) throw new Error(`Không cập nhật được ảnh ${SKU}`);

  console.log(`Đã cập nhật ảnh đúng loại cho ${SKU}: ${data.publicUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
