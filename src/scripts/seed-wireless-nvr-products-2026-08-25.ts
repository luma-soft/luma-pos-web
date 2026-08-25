import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { CURRENT_STORE_ID } from "../lib/tenancy/constants";

const MARKUP_RATE = 0.2;
const PRICE_ROUNDING_STEP = 10_000;

function calculateRetailPrice(costPrice: number) {
  return (
    Math.round((costPrice * (1 + MARKUP_RATE)) / PRICE_ROUNDING_STEP) *
    PRICE_ROUNDING_STEP
  );
}

const catalog = [
  {
    sku: "IM-NVR-N110W-8A0E",
    name: "Đầu ghi Wi-Fi IMOU N110W 10 kênh",
    fullName: "Đầu ghi Wi-Fi IMOU NVR-N110W-8A0E 10 kênh",
    brand: "IMOU",
    costPrice: 935_000,
    imagePath: "catalog-2026-08/imou/nvr-n110w-8a0e.jpg",
    imageSource:
      "https://store.imou.com/cdn/shop/files/10-channel-8mp-245ghz-wi-fi-nvr-n110w-9850087.jpg?v=1779216790&width=1000",
    specificationSource: "https://store.imou.com/it-it/products/nvr",
    description:
      "Đầu ghi Wi-Fi 6 IMOU 10 kênh, tự động ghép đôi camera IMOU, hỗ trợ camera đến 8MP, xuất hình HDMI 4K UHD, đàm thoại hai chiều và một ổ cứng SATA đến 16TB.",
    specs: {
      "Mã đầy đủ": ["NVR-N110W-8A0E"],
      "Số kênh": ["10 camera IP; hỗ trợ camera đến 8MP"],
      "Kết nối": [
        "Wi-Fi 6 băng tần kép 2.4/5GHz; 4 ăng-ten; RJ45 10/100Mbps; tự động ghép đôi camera IMOU",
      ],
      "Băng thông / giải mã": [
        "Băng thông 90Mbps; 4 kênh 8MP@15fps hoặc 4 kênh 5MP@30fps",
      ],
      "Xuất hình": ["1 HDMI đến 4K UHD; 1 VGA"],
      "Chuẩn nén": ["H.265/H.264; âm thanh AAC"],
      "Lưu trữ": ["1 SATA, HDD 3.5 inch đến 16TB; 2 cổng USB"],
      "Âm thanh": ["Micro và loa tích hợp; đàm thoại hai chiều"],
      "Nguồn / kích thước": [
        "12VDC 2A; công suất trung bình dưới 9W; 241.5 × 260 × 60.2mm; 890g không HDD",
      ],
      "Tương thích": ["Ứng dụng Imou Life; camera ONVIF; không hỗ trợ camera dùng pin"],
    },
  },
  {
    sku: "EZ-NVR-X5S-8W",
    name: "Đầu ghi Wi-Fi EZVIZ X5S 8 kênh",
    fullName: "Đầu ghi Wi-Fi EZVIZ CS-X5S-R100-8W 8 kênh",
    brand: "EZVIZ",
    costPrice: 1_050_000,
    imagePath: "catalog-2026-08/ezviz/cs-x5s-r100-8w.jpg",
    imageSource:
      "https://mfs.ezvizlife.com/29662ec0cdb2b64cf895a132d1e1ce30.jpg",
    specificationSource: "https://www.ezviz.com/inter/product/x5s/1377",
    description:
      "Đầu ghi Wi-Fi EZVIZ X5S 8 kênh cho camera đến 3K, hỗ trợ HDMI/VGA, H.265/H.264, ONVIF và một ổ cứng SATA 3.5 inch từ 1TB đến 8TB.",
    specs: {
      "Mã đầy đủ": ["CS-X5S-R100-8W (tên rút gọn: CS-X5S-8W)"],
      "Số kênh": ["8 camera Wi-Fi hoặc có dây; độ phân giải đến 3K"],
      "Kết nối": [
        "Wi-Fi 2.4GHz, 2 ăng-ten, phạm vi đến 100m; 1 cổng RJ45 10/100Mbps; băng thông yêu cầu 100Mbps",
      ],
      "Xuất hình": [
        "HDMI đến 2592 × 1944@30Hz; VGA đến 1920 × 1080@60Hz",
      ],
      "Chuẩn nén": ["H.265/H.264"],
      "Chế độ ghi": [
        "Thủ công; phát hiện chuyển động; theo lịch; kích hoạt theo sự kiện",
      ],
      "Lưu trữ": ["1 SATA, HDD 3.5 inch từ 1TB đến 8TB; 2 cổng USB 2.0"],
      "Giao thức": ["HIKVISION; ONVIF V2.5"],
      "Nguồn / kích thước": [
        "12VDC 1.5A; chờ tối đa 8W; 235 × 270 × 44.5mm; 932g",
      ],
      "Tương thích": ["Camera có nguồn điện; không hỗ trợ camera dùng pin"],
    },
  },
] as const;

async function findOrCreateCategory() {
  const [category] = await db
    .insert(categories)
    .values({ storeId: CURRENT_STORE_ID, name: "Đầu ghi camera" })
    .onConflictDoUpdate({
      target: [categories.storeId, categories.name],
      set: { name: "Đầu ghi camera" },
    })
    .returning({ id: categories.id });
  return category.id;
}

async function findOrCreateBrands() {
  await db
    .insert(brands)
    .values(
      catalog.map((item) => ({
        storeId: CURRENT_STORE_ID,
        name: item.brand,
      })),
    )
    .onConflictDoNothing({ target: [brands.storeId, brands.name] });

  const rows = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(
      and(
        eq(brands.storeId, CURRENT_STORE_ID),
        inArray(
          brands.name,
          catalog.map((item) => item.brand),
        ),
      ),
    );
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function uploadProductImages() {
  const supabase = createSupabaseAdminClient();
  const urls = new Map<string, string>();

  for (const item of catalog) {
    const response = await fetch(item.imageSource);
    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${item.sku}: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) {
      throw new Error(
        `Nguồn ảnh ${item.sku} trả về ${contentType ?? "không rõ"}`,
      );
    }

    const { error } = await supabase.storage
      .from("products")
      .upload(item.imagePath, await response.arrayBuffer(), {
        cacheControl: "31536000",
        contentType,
        upsert: true,
      });
    if (error) {
      throw new Error(
        `Không tải được ảnh ${item.sku} lên Storage: ${error.message}`,
      );
    }

    const { data } = supabase.storage
      .from("products")
      .getPublicUrl(item.imagePath);
    urls.set(item.sku, data.publicUrl);
  }

  return urls;
}

async function main() {
  for (const item of catalog) {
    const retailPrice = calculateRetailPrice(item.costPrice);
    if (retailPrice <= item.costPrice) {
      throw new Error(`Giá bán không cao hơn giá vốn: ${item.sku}`);
    }
  }

  const [categoryId, brandIds, imageUrls] = await Promise.all([
    findOrCreateCategory(),
    findOrCreateBrands(),
    uploadProductImages(),
  ]);

  await db.transaction(async (tx) => {
    for (const item of catalog) {
      const brandId = brandIds.get(item.brand);
      const imageUrl = imageUrls.get(item.sku);
      if (!brandId || !imageUrl) {
        throw new Error(`Thiếu thương hiệu hoặc ảnh cho ${item.sku}`);
      }

      const retailPrice = calculateRetailPrice(item.costPrice);
      const values = {
        storeId: CURRENT_STORE_ID,
        sku: item.sku,
        name: item.name,
        fullName: item.fullName,
        description: item.description,
        categoryId,
        brandId,
        baseUnit: "cái",
        costPrice: String(item.costPrice),
        lastPurchasePrice: String(item.costPrice),
        retailPrice: String(retailPrice),
        specs: {
          ...item.specs,
          "Nguồn thông số": [item.specificationSource],
          "Nguồn ảnh": [item.imageSource],
          "Cách tính giá bán": [
            "Giá vốn + 20%, làm tròn đến 10.000đ gần nhất",
          ],
        },
        warrantyMonths: 0,
        imageUrls: [imageUrl],
        lifecycleStatus: "active",
        isActive: true,
        updatedAt: new Date(),
      };

      await tx
        .insert(products)
        .values(values)
        .onConflictDoUpdate({
          target: [products.storeId, products.sku],
          set: values,
        });
    }
  });

  const synced = await db
    .select({
      sku: products.sku,
      name: products.name,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      imageUrls: products.imageUrls,
      specs: products.specs,
    })
    .from(products)
    .where(
      and(
        eq(products.storeId, CURRENT_STORE_ID),
        inArray(
          products.sku,
          catalog.map((item) => item.sku),
        ),
      ),
    );

  if (
    synced.length !== catalog.length ||
    synced.some(
      (item) =>
        !Array.isArray(item.imageUrls) ||
        item.imageUrls.length === 0 ||
        !item.specs,
    )
  ) {
    throw new Error("Đồng bộ hai đầu ghi chưa đầy đủ");
  }

  console.table(
    synced
      .sort((left, right) => left.sku.localeCompare(right.sku))
      .map((item) => ({
        SKU: item.sku,
        "Sản phẩm": item.name,
        "Giá vốn": item.costPrice,
        "Giá bán": item.retailPrice,
        Ảnh: "Có",
        "Thông số": "Có",
      })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
