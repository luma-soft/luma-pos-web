import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { CURRENT_STORE_ID } from "../lib/tenancy/constants";

const SKU = "HKC-MB27V39-27";
const COST_PRICE = 2_195_000;
const MARKUP_RATE = 0.2;
const PRICE_ROUNDING_STEP = 10_000;
const SPECIFICATION_SOURCE =
  "https://hkc-vn.com/san-pham/man-hinh-van-phong-hkc-mb24v39-27-inch-ips-144hz/";

const imageInputs = [
  {
    label: "mặt trước",
    envName: "HKC_MB27V39_FRONT_IMAGE",
    cliArgIndex: 2,
    storagePath: "catalog-2026-08/hkc/mb27v39-front.png",
  },
  {
    label: "mặt sau",
    envName: "HKC_MB27V39_REAR_IMAGE",
    cliArgIndex: 3,
    storagePath: "catalog-2026-08/hkc/mb27v39-rear.png",
  },
] as const;

function calculateRetailPrice(costPrice: number) {
  return (
    Math.round((costPrice * (1 + MARKUP_RATE)) / PRICE_ROUNDING_STEP) *
    PRICE_ROUNDING_STEP
  );
}

async function uploadProductImages() {
  const supabase = createSupabaseAdminClient();
  const imageUrls: string[] = [];

  for (const image of imageInputs) {
    const localPath =
      process.env[image.envName] ?? process.argv[image.cliArgIndex];
    if (!localPath) {
      throw new Error(
        `Thiếu đường dẫn ảnh ${image.label}: truyền tham số dòng lệnh hoặc biến ${image.envName}`,
      );
    }

    const bytes = await readFile(localPath);
    const { error } = await supabase.storage
      .from("products")
      .upload(image.storagePath, bytes, {
        cacheControl: "31536000",
        contentType: "image/png",
        upsert: true,
      });
    if (error) {
      throw new Error(
        `Không tải được ảnh ${image.label} lên Storage: ${error.message}`,
      );
    }

    const { data } = supabase.storage
      .from("products")
      .getPublicUrl(image.storagePath);
    imageUrls.push(data.publicUrl);
  }

  return imageUrls;
}

async function main() {
  const retailPrice = calculateRetailPrice(COST_PRICE);
  if (retailPrice !== 2_630_000) {
    throw new Error(`Giá bán tính ra không đúng kỳ vọng: ${retailPrice}`);
  }

  const [category] = await db
    .insert(categories)
    .values({ storeId: CURRENT_STORE_ID, name: "Màn hình giám sát" })
    .onConflictDoUpdate({
      target: [categories.storeId, categories.name],
      set: { name: "Màn hình giám sát" },
    })
    .returning({ id: categories.id });

  const [brand] = await db
    .insert(brands)
    .values({ storeId: CURRENT_STORE_ID, name: "HKC" })
    .onConflictDoUpdate({
      target: [brands.storeId, brands.name],
      set: { name: "HKC" },
    })
    .returning({ id: brands.id });

  const imageUrls = await uploadProductImages();
  const values = {
    storeId: CURRENT_STORE_ID,
    sku: SKU,
    name: "Màn hình HKC MB27V39 27 inch IPS 144Hz",
    fullName: "Màn hình 27 inch HKC MB27V39 IPS 144Hz 1ms Full HD",
    description:
      "Màn hình IPS 27 inch Full HD dùng xem trực tiếp đầu ghi camera qua HDMI, tần số quét 144Hz, phản hồi 1ms, góc nhìn rộng và hỗ trợ treo VESA 100 × 100mm.",
    categoryId: category.id,
    brandId: brand.id,
    baseUnit: "cái",
    costPrice: String(COST_PRICE),
    lastPurchasePrice: String(COST_PRICE),
    retailPrice: String(retailPrice),
    dimensions: "613,49 × 463,37 × 208,68 mm",
    specs: {
      "Mã sản phẩm": ["MB27V39"],
      "Kích thước / tấm nền": ["27 inch; IPS; tỷ lệ 16:9"],
      "Độ phân giải": ["Full HD 1920 × 1080"],
      "Tần số quét / phản hồi": ["144Hz; 1ms MPRT"],
      "Màu sắc": ["99% sRGB; 16,7 triệu màu"],
      "Độ sáng / tương phản": ["250cd/m²; 1000:1"],
      "Góc nhìn": ["178° ngang / 178° dọc"],
      "Kết nối": ["1 HDMI; 1 VGA (D-Sub); DC In"],
      "Treo tường": ["VESA 100 × 100mm"],
      "Phụ kiện": ["Adapter; cáp HDMI"],
      "Nguồn thông số": [SPECIFICATION_SOURCE],
      "Nguồn ảnh": ["Ảnh sản phẩm do người dùng cung cấp ngày 25/08/2026"],
      "Cách tính giá bán": [
        "Giá vốn + 20%, làm tròn đến 10.000đ gần nhất",
      ],
    },
    warrantyMonths: 24,
    imageUrls,
    lifecycleStatus: "active",
    isActive: true,
    imageUpdatedAt: new Date(),
    updatedAt: new Date(),
  };

  await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({
      target: [products.storeId, products.sku],
      set: values,
    });

  const [synced] = await db
    .select({
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      warrantyMonths: products.warrantyMonths,
      imageUrls: products.imageUrls,
      specs: products.specs,
    })
    .from(products)
    .where(
      and(eq(products.storeId, CURRENT_STORE_ID), eq(products.sku, SKU)),
    );

  if (
    !synced ||
    Number(synced.retailPrice) !== retailPrice ||
    synced.warrantyMonths !== 24 ||
    !Array.isArray(synced.imageUrls) ||
    synced.imageUrls.length !== 2 ||
    !synced.specs
  ) {
    throw new Error("Đồng bộ màn hình HKC MB27V39 chưa đầy đủ");
  }

  console.table([
    {
      SKU: synced.sku,
      "Sản phẩm": synced.name,
      "Giá vốn": synced.costPrice,
      "Giá bán": synced.retailPrice,
      "Bảo hành": `${synced.warrantyMonths} tháng`,
      Ảnh: `${synced.imageUrls.length} ảnh`,
      "Thông số": "Có",
    },
  ]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
