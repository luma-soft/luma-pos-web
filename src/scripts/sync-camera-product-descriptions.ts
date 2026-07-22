import { eq, like, or } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { buildCameraProductDescription } from "./camera-product-description";

function readSpec(specs: unknown, name: string) {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) {
    throw new Error(`Bảng thông số không hợp lệ; thiếu “${name}”.`);
  }

  const value = (specs as Record<string, unknown>)[name];
  if (!Array.isArray(value) || typeof value[0] !== "string" || !value[0].trim()) {
    throw new Error(`Thiếu thông số “${name}”.`);
  }

  return value[0];
}

async function main() {
  const cameras = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      specs: products.specs,
      warrantyMonths: products.warrantyMonths,
    })
    .from(products)
    .where(or(like(products.sku, "EZ-%"), like(products.sku, "IM-%")));

  if (cameras.length === 0) {
    throw new Error("Không tìm thấy camera EZVIZ/IMOU để cập nhật mô tả.");
  }

  const descriptions = cameras.map((product) => {
    try {
      return {
        id: product.id,
        description: buildCameraProductDescription({
          name: product.name,
          fullCode: readSpec(product.specs, "Mã đầy đủ"),
          resolution: readSpec(product.specs, "Độ phân giải"),
          lens: readSpec(product.specs, "Ống kính / góc nhìn"),
          connection: readSpec(product.specs, "Kết nối"),
          nightAndProtection: readSpec(product.specs, "Ban đêm / bảo vệ"),
          powerAndStorage: readSpec(product.specs, "Nguồn / lưu trữ"),
          features: readSpec(product.specs, "Tính năng chính"),
          warrantyMonths: product.warrantyMonths ?? 24,
        }),
      };
    } catch (error) {
      throw new Error(
        `Không thể tạo mô tả cho ${product.sku}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  await db.transaction(async (tx) => {
    for (const product of descriptions) {
      await tx
        .update(products)
        .set({ description: product.description, updatedAt: new Date() })
        .where(eq(products.id, product.id));
    }
  });

  console.log(`Đã cập nhật mô tả chi tiết cho ${descriptions.length} camera.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
