import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, products } from "../db/schema";

const BRAND_NAMES = ["Rạng Đông", "Rạng Đông Smart"] as const;
const ROUNDING_STEP = 10_000;

function roundUpPrice(value: number) {
  return Math.ceil(value / ROUNDING_STEP) * ROUNDING_STEP;
}

async function main() {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      retailPrice: products.retailPrice,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(brands.name, [...BRAND_NAMES]));

  const updates = rows.flatMap((product) => {
    const currentPrice = Number(product.retailPrice);
    if (!Number.isFinite(currentPrice) || currentPrice < 0) {
      throw new Error(
        `Giá bán không hợp lệ: ${product.sku}=${product.retailPrice}`,
      );
    }
    const roundedPrice = roundUpPrice(currentPrice);
    return roundedPrice === currentPrice
      ? []
      : [{ ...product, currentPrice, roundedPrice }];
  });

  if (!rows.length) {
    throw new Error(
      `Không tìm thấy sản phẩm thuộc thương hiệu: ${BRAND_NAMES.join(", ")}`,
    );
  }

  await db.transaction(async (tx) => {
    for (const item of updates) {
      await tx
        .update(products)
        .set({
          retailPrice: item.roundedPrice.toFixed(2),
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, item.id));
    }
  });

  const remaining = await db
    .select({
      sku: products.sku,
      retailPrice: products.retailPrice,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(brands.name, [...BRAND_NAMES]));

  const invalid = remaining.filter(
    (product) => Number(product.retailPrice) % ROUNDING_STEP !== 0,
  );
  if (invalid.length) {
    throw new Error(
      `Còn giá chưa làm tròn: ${invalid
        .map((item) => `${item.sku}=${item.retailPrice}`)
        .join(", ")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        matched: rows.length,
        updated: updates.length,
        unchanged: rows.length - updates.length,
        changes: updates.map((item) => ({
          sku: item.sku,
          from: item.currentPrice,
          to: item.roundedPrice,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
