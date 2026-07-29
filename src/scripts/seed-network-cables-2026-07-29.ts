import { inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const catalog = [
  {
    sku: "504585",
    name: "Dây mạng TAESUNG Cat5E UTP đồng 0.45mm, 305m/cuộn",
    fullName:
      "Dây mạng TAESUNG Cat5E UTP, đồng không dầu 8 lõi CU 0.45mm, vỏ xanh lá, dây trắng, loại đắt, 305m/cuộn (504585)",
    brand: "Taesung",
    category: "Dây Mạng",
    baseUnit: "cuộn",
    costPrice: 1_700_000,
    retailPrice: 2_500_000,
    description:
      "Cáp mạng TAESUNG Cat5E UTP gồm 4 cặp xoắn (8 lõi) đồng không dầu CU 0.45mm, dây màu trắng, vỏ PVC xanh lá; quy cách 305m/cuộn, phiên bản loại đắt.",
    warrantyMonths: 0,
    specs: {
      "Mã sản phẩm": ["504585"],
      "Chuẩn cáp": ["Cat5E UTP"],
      "Lõi dẫn": ["8 lõi đồng không dầu"],
      "Đường kính lõi": ["CU 0.45mm"],
      "Màu dây": ["Trắng"],
      "Màu vỏ": ["Xanh lá cây"],
      "Phân loại": ["Loại đắt"],
      "Quy cách": ["305m/cuộn"],
    },
    image: {
      path: "catalog-2026-07/taesung-cat5e-utp-504585.png",
      source:
        "https://congnghiephaiphong.com/wp-content/uploads/Z9zLSfxqFS.png",
    },
  },
  {
    sku: "506640",
    name: "Dây điện thoại TAESUNG 4 lõi đồng có thép gia cường, 500m/cuộn",
    fullName:
      "Dây điện thoại TAESUNG 4 lõi đồng, thép gia cường 7 sợi × 0.33mm, vỏ đen, lô nhựa, có băng nhôm, 500m/cuộn (506640)",
    brand: "Taesung",
    category: "Điện",
    baseUnit: "cuộn",
    costPrice: 1_750_000,
    retailPrice: 2_200_000,
    description:
      "Dây điện thoại TAESUNG 4 lõi đồng, có băng nhôm chống nhiễu và 7 sợi thép gia cường đường kính 0.33mm; vỏ đen, đóng lô nhựa, quy cách 500m/cuộn.",
    warrantyMonths: 0,
    specs: {
      "Mã sản phẩm": ["506640"],
      "Loại dây": ["Dây điện thoại"],
      "Lõi dẫn": ["4 lõi đồng"],
      "Chống nhiễu": ["Có băng nhôm"],
      "Gia cường": ["7 sợi thép × 0.33mm"],
      "Màu vỏ": ["Đen"],
      "Đóng gói": ["Lô nhựa"],
      "Quy cách": ["500m/cuộn"],
    },
    image: {
      path: "catalog-2026-07/taesung-telephone-4-core-506640.jpg",
      source:
        "https://www.nhatthuc.com.vn/images_upload/z6234098252583_4fd9d27a2b6ecc9b6a1234750bb7f1e9.jpg",
    },
  },
  {
    sku: "NET-WINCAP-CAT6E-CCA-23AWG",
    name: "Dây mạng WINCAP Cat6E UTP CCA 23AWG, 305m/cuộn",
    fullName:
      "Dây mạng WINCAP Cat6E UTP CCA, 23AWG 0.52mm, 8 lõi, vỏ PVC xanh, thùng đỏ trắng, 305m/cuộn",
    brand: "Wincap",
    category: "Dây Mạng",
    baseUnit: "cuộn",
    costPrice: 940_000,
    retailPrice: 1_290_000,
    description:
      "Cáp mạng WINCAP Cat6E UTP gồm 8 lõi CCA 23AWG đường kính 0.52mm, vỏ PVC màu xanh; quy cách 305m/cuộn, phiên bản thùng đỏ trắng.",
    warrantyMonths: 0,
    specs: {
      "Chuẩn cáp": ["Cat6E UTP"],
      "Lõi dẫn": ["8 lõi CCA"],
      "Cỡ dây": ["23AWG"],
      "Đường kính lõi": ["0.52mm"],
      "Màu vỏ": ["Xanh"],
      "Phân biệt bao bì": ["Thùng đỏ trắng"],
      "Quy cách": ["305m/cuộn"],
    },
    image: {
      path: "catalog-2026-07/wincap-cat6e-cca-23awg-red-white.jpg",
      source:
        "https://sondat.vn/upload/product/15-7-2023/day-cap-mang-cat6e-9.jpg",
    },
  },
] as const;

async function uploadProductImages() {
  const supabase = createSupabaseAdminClient();
  const urls = new Map<string, string>();

  for (const item of catalog) {
    const response = await fetch(item.image.source);
    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${item.sku}: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) {
      throw new Error(`Nguồn ảnh ${item.sku} trả về ${contentType ?? "không rõ"}`);
    }

    const { error } = await supabase.storage
      .from("products")
      .upload(item.image.path, await response.arrayBuffer(), {
        contentType,
        upsert: true,
      });
    if (error) {
      throw new Error(`Không tải được ảnh ${item.sku} lên Storage: ${error.message}`);
    }

    const { data } = supabase.storage
      .from("products")
      .getPublicUrl(item.image.path);
    urls.set(item.sku, data.publicUrl);
  }

  return urls;
}

async function main() {
  const imageUrls = await uploadProductImages();
  const categoryNames = [...new Set(catalog.map((item) => item.category))];
  const brandNames = [...new Set(catalog.map((item) => item.brand))];

  await db
    .insert(brands)
    .values(brandNames.map((name) => ({ name })))
    .onConflictDoNothing({ target: brands.name });

  const [categoryRows, brandRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.name, categoryNames)),
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(inArray(brands.name, brandNames)),
  ]);
  const categoryIds = new Map(categoryRows.map((row) => [row.name, row.id]));
  const brandIds = new Map(brandRows.map((row) => [row.name, row.id]));

  const missingCategories = categoryNames.filter(
    (name) => !categoryIds.has(name),
  );
  if (missingCategories.length > 0) {
    throw new Error(`Thiếu nhóm hàng: ${missingCategories.join(", ")}`);
  }

  await db.transaction(async (tx) => {
    for (const item of catalog) {
      const imageUrl = imageUrls.get(item.sku)!;
      const values = {
        name: item.name,
        fullName: item.fullName,
        description: item.description,
        categoryId: categoryIds.get(item.category)!,
        brandId: brandIds.get(item.brand)!,
        baseUnit: item.baseUnit,
        costPrice: String(item.costPrice),
        lastPurchasePrice: String(item.costPrice),
        retailPrice: String(item.retailPrice),
        specs: item.specs,
        warrantyMonths: item.warrantyMonths,
        imageUrls: [imageUrl] as string[],
        lifecycleStatus: "active",
        isActive: true,
        updatedAt: sql`now()`,
      } as const;

      await tx
        .insert(products)
        .values({ sku: item.sku, ...values })
        .onConflictDoUpdate({
          target: products.sku,
          set: values,
        });
    }
  });

  const saved = await db
    .select({
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      baseUnit: products.baseUnit,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .where(inArray(products.sku, catalog.map((item) => item.sku)));

  if (saved.length !== catalog.length) {
    throw new Error(`Lưu thiếu sản phẩm: cần ${catalog.length}, có ${saved.length}`);
  }

  for (const row of saved) {
    if (!Array.isArray(row.imageUrls) || row.imageUrls.length === 0) {
      throw new Error(`Sản phẩm ${row.sku} chưa có ảnh`);
    }
  }

  console.table(
    saved
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((row) => ({
        SKU: row.sku,
        "Sản phẩm": row.name,
        "Giá nhập": row.costPrice,
        "Giá bán": row.retailPrice,
        "Đơn vị": row.baseUnit,
        Ảnh: row.imageUrls?.[0],
      })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
