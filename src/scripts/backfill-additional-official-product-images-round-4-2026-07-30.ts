import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import { brands, products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  imageUrls: string[] | null;
};

type ImageRule = {
  key: string;
  source: string;
  sourcePage: string;
  skus: readonly string[];
};

const SINO_CDN =
  "https://cdn-img-v2.mybota.vn/uploadv2/web/11/11232/product";

const imageRules: readonly ImageRule[] = [
  // Panasonic — ảnh đúng model/màu từ website và cửa hàng chính hãng.
  {
    key: "panasonic-f-60gds-brown",
    source:
      "https://store.apac.panasonic.com/media/catalog/product/f/-/f-60gds-b.png",
    sourcePage: "https://store.apac.panasonic.com/vn/f-60gds-b.html",
    skus: ["SP052942"],
  },
  {
    key: "panasonic-f-60gds-white",
    source:
      "https://store.apac.panasonic.com/media/catalog/product/f/-/f-60gds-w.png",
    sourcePage: "https://store.apac.panasonic.com/vn/f-60gds-w.html",
    skus: ["SP052892"],
  },

  // Sino — ảnh đúng họ phụ kiện ống và đúng mã/màu của dòng Deaking.
  {
    key: "sino-conduit-elbow",
    source: `${SINO_CDN}/2019/06/12/07/21/1560324106_cut-thu.png?v=4`,
    sourcePage: "https://sino.com.vn/cut-thu-1-1-1467064.html",
    skus: ["SP000894", "SP000895", "SP000896", "SP001900"],
  },
  {
    key: "sino-conduit-tee",
    source: `${SINO_CDN}/2019/06/13/01/58/1560391127_cut-t-ko-nap.png?v=4`,
    sourcePage: "https://sino.com.vn/cut-t-khon-nap-1-1-1468950.html",
    skus: ["SP000907", "SP000908", "SP000909", "SP001898"],
  },
  {
    key: "sino-three-way-junction-box",
    source: `${SINO_CDN}/2026/03/14/03/09/1773474612_1560324598_chia-nga-4.png?v=4`,
    sourcePage: "https://sino.com.vn/hop-chia-nga-kieu-v-1-1-1467796.html",
    skus: ["SP000910"],
  },
  {
    key: "sino-deaking-dkcc-s-s-xak",
    source: `${SINO_CDN}/2025/10/04/09/31/1759545047_dkcc-s-s-xak.png?v=4`,
    sourcePage: "https://sino.com.vn/cong-tac-dkccss-1-1-2415128.html",
    skus: ["SP052912"],
  },
  {
    key: "sino-deaking-dkcc-nrd",
    source: `${SINO_CDN}/2022/11/17/07/03/1668655278_dkcc-nrd-dod.png?v=4`,
    sourcePage: "https://sino.com.vn/den-bao-do-dkccnrd-1-1-2422476.html",
    skus: ["SP052913"],
  },
  {
    key: "sino-deaking-dkcc-u-cn-xak",
    source: `${SINO_CDN}/2023/10/20/05/15/1697775763_dkcc-u-cn-.png?v=4`,
    sourcePage: "https://sino.com.vn/o-cam-dkccucnxak-1-1-2557134.html",
    skus: ["SP052911"],
  },
  {
    key: "sino-deaking-dk18e-2x-inv-xak",
    source: `${SINO_CDN}/2022/10/21/12/23/1666257025_dk18e-2x-inv-xak.png?v=4`,
    sourcePage: "https://sino.com.vn/mat-dk18e2xinvxak-1-1-2414924.html",
    skus: ["SP052909"],
  },
  {
    key: "sino-deaking-dk18e-3x-inv-xak",
    source: `${SINO_CDN}/2022/10/21/12/31/1666257501_dk18e-3x-inv-xak.png?v=4`,
    sourcePage: "https://sino.com.vn/mat-dk18e3xinvxak-1-1-2414926.html",
    skus: ["SP052910"],
  },

  // Tân Á, Senko và LiOA — dung tích/model được đối chiếu trực tiếp.
  {
    key: "tan-a-inox-tank-1000-vertical",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/08/36.jpg",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/bon-nuoc-inox-tan-a-1000d/",
    skus: ["SP001863"],
  },
  {
    key: "tan-a-inox-tank-500-vertical",
    source:
      "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Tan-A-dung.png",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/bon-nuoc-inox-tan-a-500d/",
    skus: ["SP052947"],
  },
  {
    key: "senko-lts1636",
    source: "https://www.senko.com.vn/media/2040/lts1636-01.jpg",
    sourcePage: "https://www.senko.com.vn/san-pham/quat-lo/lts1636/",
    skus: ["SP002860"],
  },
  {
    key: "lioa-onc-phi-5",
    source:
      "https://lioa.com.vn/wp-content/uploads/2025/09/o-cam-noi-da-nang-lioa-ONCΦ5.webp",
    sourcePage: "https://lioa.com.vn/o-cam-noi-da-nang-lioa",
    skus: ["SP000876"],
  },
] as const;

function isMissingImage(imageUrls: string[] | null) {
  return !Array.isArray(imageUrls) || imageUrls.every((url) => !url?.trim());
}

function extensionFor(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function summarize(
  assignments: ReadonlyMap<string, { product: ProductRow; rule: ImageRule }>,
) {
  const counts = new Map<string, number>();
  for (const { product } of assignments.values()) {
    const brand = product.brand || "Không gắn hãng";
    counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return [...counts].map(([brand, count]) => ({ Hãng: brand, "Sản phẩm": count }));
}

async function main() {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      brand: brands.name,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.isActive, true));

  const ruleBySku = new Map<string, ImageRule>();
  for (const rule of imageRules) {
    for (const sku of rule.skus) {
      if (ruleBySku.has(sku)) throw new Error(`SKU ${sku} xuất hiện trong nhiều quy tắc`);
      ruleBySku.set(sku, rule);
    }
  }

  const assignments = new Map<string, { product: ProductRow; rule: ImageRule }>();
  for (const product of rows) {
    const rule = ruleBySku.get(product.sku);
    if (rule && isMissingImage(product.imageUrls)) {
      assignments.set(product.id, { product, rule });
    }
  }

  if (assignments.size === 0) {
    console.log("Không còn sản phẩm phù hợp nào thiếu ảnh.");
    return;
  }

  console.table(summarize(assignments));
  if (process.argv.includes("--dry-run")) {
    console.log(`Dry run: sẽ bổ sung ${assignments.size} sản phẩm.`);
    return;
  }

  const usedRules = [
    ...new Map([...assignments.values()].map(({ rule }) => [rule.key, rule])).values(),
  ];
  const supabase = createSupabaseAdminClient();
  const publicUrls = new Map<string, string>();

  for (const rule of usedRules) {
    const response = await fetch(rule.source, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
        Referer: rule.sourcePage,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Không tải được ảnh ${rule.key}: HTTP ${response.status} (${rule.sourcePage})`,
      );
    }
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Nguồn ${rule.key} trả về ${contentType || "không rõ"}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 120 || metadata.height < 120) {
      throw new Error(
        `Ảnh ${rule.key} quá nhỏ: ${metadata.width ?? "?"}x${metadata.height ?? "?"}`,
      );
    }

    const path = `official-catalog-2026-07-round-4/${rule.key}.${extensionFor(contentType)}`;
    const { error } = await supabase.storage.from("products").upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Không tải được ${rule.key} lên Storage: ${error.message}`);
    publicUrls.set(
      rule.key,
      supabase.storage.from("products").getPublicUrl(path).data.publicUrl,
    );
  }

  await db.transaction(async (tx) => {
    for (const { product, rule } of assignments.values()) {
      const [updated] = await tx
        .update(products)
        .set({ imageUrls: [publicUrls.get(rule.key)!], updatedAt: sql`now()` })
        .where(
          and(
            eq(products.id, product.id),
            sql`(${products.imageUrls} is null or jsonb_array_length(${products.imageUrls}) = 0)`,
          ),
        )
        .returning({ sku: products.sku });
      if (!updated) throw new Error(`Không cập nhật được ${product.sku}`);
    }
  });

  const verified = await db
    .select({ id: products.id, imageUrls: products.imageUrls })
    .from(products)
    .where(inArray(products.id, [...assignments.keys()]));
  const failures = verified.filter((row) => isMissingImage(row.imageUrls));
  if (verified.length !== assignments.size || failures.length > 0) {
    throw new Error(
      `Xác minh thất bại: cần ${assignments.size}, đọc được ${verified.length}, thiếu ${failures.length}`,
    );
  }

  console.log(
    `Đã bổ sung và xác minh ${verified.length} sản phẩm bằng ${usedRules.length} ảnh chính thức.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
