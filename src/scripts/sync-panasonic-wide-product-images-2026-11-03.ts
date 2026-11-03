import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { products, stores } from "../db/schema";

const STORE_SLUG = "hai-dang";

const imageSources = [
  {
    sku: "WEV1582H",
    source:
      "https://product.hstatic.net/1000333175/product/o_cam_doi_wev1582h__wev1582-7h_62b54abab5744c998e25c392e90a549d_master.jpg",
  },
  {
    sku: "WEV68010MH",
    source:
      "https://tuyetlights.com/Files/90/thiet-bi-dien/cong-tac-o-cam-panasonic/panasonic-full-wide-series/68010mh.jpg",
  },
  {
    sku: "WEG68020MH",
    source: "https://lssth.panasonic.com/product_finder/img/WEG6802MH.png",
  },
  {
    sku: "WEV68030MH",
    source:
      "https://tuyetlights.com/Files/90/thiet-bi-dien/cong-tac-o-cam-panasonic/panasonic-full-wide-series/WEV68030MH.jpg",
  },
  {
    sku: "WEV1081H",
    source:
      "https://quydan.com.vn/upload/images/san-pham/Panasonic/o-cam-don-wev1081h-wev1081-7h-6541.jpg",
  },
  {
    sku: "WEG3032RH",
    source: "https://khalinguyen.vn/uploads/panasonic/weg3032rh/weg3032rh.jpg",
  },
  {
    sku: "WEV5002H",
    source: "https://www.thietbidiendgp.vn/media/products/800/wev5002h-1.jpg",
  },
  {
    sku: "WEV5001H",
    source:
      "https://thietbidienpanasonic.com.vn/Upload/image/2023/02/12/cong-tac-b-panasonic-wev5001h_2023-02-12-111943.png",
  },
] as const;

async function main() {
  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.slug, STORE_SLUG), eq(stores.status, "active")))
    .limit(1);
  if (!store) throw new Error(`Không tìm thấy cửa hàng đang hoạt động ${STORE_SLUG}`);

  const existing = await db
    .select({ sku: products.sku })
    .from(products)
    .where(
      and(
        eq(products.storeId, store.id),
        inArray(products.sku, imageSources.map((item) => item.sku)),
      ),
    );
  const existingSkus = new Set(existing.map((item) => item.sku));
  const missingSkus = imageSources
    .map((item) => item.sku)
    .filter((sku) => !existingSkus.has(sku));
  if (missingSkus.length > 0) {
    throw new Error(`Thiếu sản phẩm cần gắn ảnh: ${missingSkus.join(", ")}`);
  }

  const updated = await db.transaction(async (tx) => {
    const rows = [];
    for (const item of imageSources) {
      const [row] = await tx
        .update(products)
        .set({ imageUrls: [item.source], updatedAt: new Date() })
        .where(
          and(
            eq(products.storeId, store.id),
            eq(products.sku, item.sku),
          ),
        )
        .returning({ sku: products.sku, imageUrls: products.imageUrls });
      if (!row) throw new Error(`Không cập nhật được ảnh cho ${item.sku}`);
      rows.push(row);
    }
    return rows;
  });

  if (
    updated.length !== imageSources.length ||
    updated.some((item) => {
      const expectedUrl = imageSources.find((source) => source.sku === item.sku)?.source;
      return !Array.isArray(item.imageUrls) || item.imageUrls[0] !== expectedUrl;
    })
  ) {
    throw new Error("Đồng bộ ảnh Panasonic Wide chưa đầy đủ");
  }

  console.log(`Đã gắn URL ảnh cho ${updated.length} sản phẩm Panasonic Wide tại ${STORE_SLUG}.`);
  console.table(
    updated
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((item) => ({ SKU: item.sku, Ảnh: item.imageUrls?.[0] ? "Có" : "Thiếu" })),
  );
}

main()
  .then(() => db.$client.end())
  .catch(async (error) => {
    console.error(error);
    await db.$client.end();
    process.exitCode = 1;
  });
