import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const images = [
  {
    sku: "MEM-KIOXIA-128GB",
    path: "catalog-2026-07/kioxia-exceria-128gb.png",
    source:
      "https://europe.kioxia.com/content/dam/kioxia/shared/personal/micro-sd/img/exceria_img_prd002.png",
    contentType: "image/png",
  },
  {
    sku: "MEM-LEXAR-512GB-LSDMI512BB633A",
    path: "catalog-2026-07/lexar-633x-blue-512gb.png",
    source:
      "https://www-oss.lexar.com/uploads/product_images/633sdmi_slider_512GB_1.png",
    contentType: "image/png",
  },
  {
    sku: "MAT-CAM-JBOX-STD",
    path: "catalog-2026-07/camera-junction-box-standard.jpg",
    source:
      "https://image.anhducdigital.vn/smarthome/phu-kien-camera/chan-de-camera/hop-ky-thuat-lap-camera/hop-ky-thuat-lap-camera-500x500.jpg",
    contentType: "image/jpeg",
  },
  {
    sku: "NET-TENDA-N301",
    path: "catalog-2026-07/tenda-n301.png",
    source:
      "https://static.tenda.com.cn/tdeweb/public/images/product2/459.png",
    contentType: "image/png",
  },
] as const;

async function main() {
  const skus = images.map((image) => image.sku);
  const existingProducts = await db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(inArray(products.sku, skus));
  const productBySku = new Map(
    existingProducts.map((product) => [product.sku, product.id]),
  );
  const missingSkus = skus.filter((sku) => !productBySku.has(sku));
  if (missingSkus.length > 0) {
    throw new Error(`Không tìm thấy sản phẩm: ${missingSkus.join(", ")}`);
  }

  const supabase = createSupabaseAdminClient();
  const publicUrls = new Map<string, string>();

  for (const image of images) {
    const response = await fetch(image.source);
    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${image.sku}: HTTP ${response.status}`);
    }

    const responseType = response.headers.get("content-type")?.split(";")[0];
    if (!responseType?.startsWith("image/")) {
      throw new Error(`Nguồn ${image.sku} không trả về file ảnh`);
    }

    const { error } = await supabase.storage
      .from("products")
      .upload(image.path, await response.arrayBuffer(), {
        contentType: image.contentType,
        upsert: true,
      });
    if (error) {
      throw new Error(`Không tải được ảnh ${image.sku} lên Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from("products").getPublicUrl(image.path);
    publicUrls.set(image.sku, data.publicUrl);
  }

  await db.transaction(async (tx) => {
    for (const image of images) {
      const [updated] = await tx
        .update(products)
        .set({
          imageUrls: [publicUrls.get(image.sku)!],
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, productBySku.get(image.sku)!))
        .returning({ sku: products.sku });
      if (!updated) throw new Error(`Không cập nhật được ảnh ${image.sku}`);
    }
  });

  console.log(`Đã bổ sung ảnh cho ${images.length} sản phẩm: ${skus.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
