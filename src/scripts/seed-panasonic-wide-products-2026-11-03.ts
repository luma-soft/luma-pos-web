import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products, stores } from "../db/schema";

const STORE_SLUG = "hai-dang";
const CATEGORY_NAME = "Thiết bị điện";
const BRAND_NAME = "Panasonic";

const catalog = [
  {
    sku: "WEV1582H",
    name: "Ổ cắm đôi Panasonic Wide màu xám (WEV1582H)",
    costPrice: 94_843,
    lastPurchasePrice: 94_843,
    retailPrice: 120_000,
    color: "Xám",
    description: "Ổ cắm đôi Panasonic Wide, màu xám, loại cắm nhanh.",
  },
  {
    sku: "WEV68010MH",
    name: "Mặt Panasonic Wide 1 thiết bị màu xám ánh kim (WEV68010MH)",
    costPrice: 21_906,
    lastPurchasePrice: 32_695,
    retailPrice: 25_000,
    color: "Xám ánh kim",
    description: "Mặt Panasonic Wide 1 thiết bị, màu xám ánh kim.",
  },
  {
    sku: "WEG68020MH",
    name: "Mặt Panasonic Wide 2 thiết bị màu đen (WEG68020MH)",
    costPrice: 19_601,
    lastPurchasePrice: 19_601,
    retailPrice: 25_000,
    color: "Đen",
    description: "Mặt Panasonic Wide 2 thiết bị, màu đen.",
  },
  {
    sku: "WEV68030MH",
    name: "Mặt Panasonic Wide 3 thiết bị màu xám ánh kim (WEV68030MH)",
    costPrice: 21_056,
    lastPurchasePrice: 21_056,
    retailPrice: 25_000,
    color: "Xám ánh kim",
    description: "Mặt Panasonic Wide 3 thiết bị, màu xám ánh kim.",
  },
  {
    sku: "WEV1081H",
    name: "Ổ cắm đơn Panasonic Wide có màn che màu xám (WEV1081H)",
    costPrice: 36_838,
    lastPurchasePrice: 54_982,
    retailPrice: 40_000,
    color: "Xám",
    description: "Ổ cắm đơn Panasonic Wide có màn che, màu xám, loại cắm nhanh.",
  },
  {
    sku: "WEG3032RH",
    name: "Đèn báo Panasonic Wide màu đỏ (WEG3032RH)",
    costPrice: 101_167,
    lastPurchasePrice: 101_167,
    retailPrice: 106_000,
    color: "Đỏ",
    description: "Đèn báo Panasonic Wide màu đỏ.",
  },
  {
    sku: "WEV5002H",
    name: "Công tắc Panasonic Wide C, 2 chiều màu xám (WEV5002H)",
    costPrice: 46_442,
    lastPurchasePrice: 69_317,
    retailPrice: 50_000,
    color: "Xám",
    description: "Công tắc Panasonic Wide loại C, 2 chiều, màu xám.",
  },
  {
    sku: "WEV5001H",
    name: "Công tắc Panasonic Wide B, 1 chiều màu xám (WEV5001H)",
    costPrice: 27_135,
    lastPurchasePrice: 40_500,
    retailPrice: 30_000,
    color: "Xám",
    description: "Công tắc Panasonic Wide loại B, 1 chiều, màu xám.",
  },
] as const;

async function main() {
  if (catalog.length !== 8) {
    throw new Error(`Danh sách phải có 8 sản phẩm, hiện có ${catalog.length}`);
  }

  for (const item of catalog) {
    if (item.retailPrice <= item.costPrice) {
      throw new Error(`Giá bán không cao hơn giá nhập: ${item.sku}`);
    }
    if (!item.name.includes(item.sku)) {
      throw new Error(`Tên sản phẩm chưa có mã: ${item.sku}`);
    }
  }

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.slug, STORE_SLUG), eq(stores.status, "active")))
    .limit(1);
  if (!store) throw new Error(`Không tìm thấy cửa hàng đang hoạt động ${STORE_SLUG}`);

  const existing = await db
    .select({ sku: products.sku, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.storeId, store.id),
        inArray(products.sku, catalog.map((item) => item.sku)),
      ),
    );
  if (existing.length > 0) {
    throw new Error(
      `Không thêm để tránh ghi đè sản phẩm đã có: ${existing
        .map((item) => `${item.sku} (${item.name})`)
        .join(", ")}`,
    );
  }

  const inserted = await db.transaction(async (tx) => {
    const [category] = await tx
      .insert(categories)
      .values({ storeId: store.id, name: CATEGORY_NAME })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    const [savedCategory] = category
      ? [category]
      : await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.storeId, store.id),
              eq(categories.name, CATEGORY_NAME),
            ),
          )
          .limit(1);
    if (!savedCategory) throw new Error(`Không tạo được nhóm ${CATEGORY_NAME}`);

    const [brand] = await tx
      .insert(brands)
      .values({ storeId: store.id, name: BRAND_NAME })
      .onConflictDoNothing()
      .returning({ id: brands.id });
    const [savedBrand] = brand
      ? [brand]
      : await tx
          .select({ id: brands.id })
          .from(brands)
          .where(
            and(eq(brands.storeId, store.id), eq(brands.name, BRAND_NAME)),
          )
          .limit(1);
    if (!savedBrand) throw new Error(`Không tạo được thương hiệu ${BRAND_NAME}`);

    return tx
      .insert(products)
      .values(
        catalog.map((item) => ({
          storeId: store.id,
          sku: item.sku,
          name: item.name,
          fullName: item.name,
          description: item.description,
          categoryId: savedCategory.id,
          brandId: savedBrand.id,
          baseUnit: "cái",
          costPrice: String(item.costPrice),
          lastPurchasePrice: String(item.lastPurchasePrice),
          retailPrice: String(item.retailPrice),
          specs: {
            "Mã sản phẩm": [item.sku],
            "Dòng sản phẩm": ["Panasonic Wide"],
            "Màu sắc": [item.color],
          },
          warrantyMonths: 0,
          imageUrls: [],
          lifecycleStatus: "active",
          isActive: true,
        })),
      )
      .returning({
        sku: products.sku,
        name: products.name,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
      });
  });

  if (inserted.length !== catalog.length) {
    throw new Error(`Đã lưu thiếu sản phẩm: cần ${catalog.length}, có ${inserted.length}`);
  }

  console.log(`Đã tạo ${inserted.length} sản phẩm Panasonic Wide tại ${STORE_SLUG}.`);
  console.table(
    inserted
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((item) => ({
        SKU: item.sku,
        "Tên sản phẩm": item.name,
        "Giá vốn": item.costPrice,
        "Giá nhập gần nhất": item.lastPurchasePrice,
        "Giá bán": item.retailPrice,
      })),
  );
}

main()
  .then(() => db.$client.end())
  .catch(async (error) => {
    console.error(error);
    await db.$client.end();
    process.exitCode = 1;
  });
