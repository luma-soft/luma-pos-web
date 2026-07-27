import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";

const priceUpdates = [
  {
    sku: "MAT-CAM-BRACKET-IP",
    expectedCost: "7000.00",
    retailPrice: "15000.00",
  },
  {
    sku: "MAT-CAM-JBOX-STD",
    expectedCost: "6000.00",
    retailPrice: "15000.00",
  },
] as const;

async function main() {
  const skus = priceUpdates.map((item) => item.sku);
  const currentProducts = await db
    .select({
      id: products.id,
      sku: products.sku,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
    })
    .from(products)
    .where(inArray(products.sku, skus));
  const productBySku = new Map(
    currentProducts.map((product) => [product.sku, product]),
  );

  const missingSkus = skus.filter((sku) => !productBySku.has(sku));
  if (missingSkus.length > 0) {
    throw new Error(`Không tìm thấy sản phẩm: ${missingSkus.join(", ")}`);
  }

  for (const item of priceUpdates) {
    const product = productBySku.get(item.sku)!;
    if (product.costPrice !== item.expectedCost) {
      throw new Error(
        `Giá nhập ${item.sku} đã thay đổi: ${product.costPrice}, dự kiến ${item.expectedCost}`,
      );
    }
    if (Number(item.retailPrice) <= Number(product.costPrice)) {
      throw new Error(`Giá bán mới ${item.sku} phải lớn hơn giá nhập`);
    }
  }

  await db.transaction(async (tx) => {
    for (const item of priceUpdates) {
      await tx
        .update(products)
        .set({
          retailPrice: item.retailPrice,
          updatedAt: sql`now()`,
        })
        .where(eq(products.sku, item.sku));
    }
  });

  console.log(
    `Đã cập nhật giá bán: ${priceUpdates
      .map((item) => `${item.sku}=${item.retailPrice}`)
      .join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
