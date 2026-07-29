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

const DISMY_UPLOADS = "https://cucphuong.com.vn/wp-content/uploads";

const imageRules: readonly ImageRule[] = [
  // DISMY/Cúc Phương — ảnh theo đúng họ phụ kiện trong catalog chính hãng.
  {
    key: "dismy-ppr-cap",
    source: `${DISMY_UPLOADS}/2023/01/Bi-chup-ngoai-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/bit-chup-ngoai/",
    skus: ["SP053123", "SP053124"],
  },
  {
    key: "dismy-ppr-elbow",
    source: `${DISMY_UPLOADS}/2023/01/noi-goc-90-do-3-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/noi-goc-90-do-2/",
    skus: ["SP053110", "SP053121"],
  },
  {
    key: "dismy-ppr-female-elbow",
    source: `${DISMY_UPLOADS}/2023/01/noi-goc-90-do-ren-trong-2-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/noi-goc-90-do-ren-trong/",
    skus: ["SP053111", "SP053122"],
  },
  {
    key: "dismy-ppr-straight-coupler",
    source: `${DISMY_UPLOADS}/2023/01/dau-noi-thang-3-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/dau-noi-thang-2/",
    skus: ["SP053112"],
  },
  {
    key: "dismy-ppr-female-coupler",
    source: `${DISMY_UPLOADS}/2023/01/dau-noi-ren-trong-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/dau-noi-ren-trong-2/",
    skus: ["SP053235"],
  },
  {
    key: "dismy-ppr-pipe",
    source: `${DISMY_UPLOADS}/2023/01/ong-PPR-xanh-2-1-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/ong-nhua-ppr/",
    skus: ["SP053085", "SP053131"],
  },
  {
    key: "dismy-ppr-crossover",
    source: `${DISMY_UPLOADS}/2023/01/ong-tranh-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/ong-tranh/",
    skus: ["SP053234"],
  },
  {
    key: "dismy-ppr-equal-tee",
    source: `${DISMY_UPLOADS}/2023/01/ba-chac-90-do-3-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/ba-chac-90-do/",
    skus: ["SP053119", "SP053120"],
  },
  {
    key: "dismy-ppr-female-tee",
    source: `${DISMY_UPLOADS}/2023/01/ba-chac-90-do-ren-trong-1-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/ba-chac-90-do-ren-trong-2/",
    skus: ["SP053242"],
  },
  {
    key: "dismy-upvc-cleanout-plug",
    source: `${DISMY_UPLOADS}/2021/12/bit-xa-thong-tac-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/bit-xa-thong-tac/",
    skus: ["SP053129", "SP053130"],
  },
  {
    key: "dismy-upvc-45-elbow",
    source: `${DISMY_UPLOADS}/2021/12/Anh-chinh24.jpg`,
    sourcePage: "https://cucphuong.com.vn/chech-u-pvc/",
    skus: ["SP053090", "SP053091", "SP053092", "SP053093", "SP053127"],
  },
  {
    key: "dismy-upvc-90-elbow",
    source: `${DISMY_UPLOADS}/2021/12/Anh-phu16.jpg`,
    sourcePage: "https://cucphuong.com.vn/cut-u-pvc/",
    skus: ["SP053086", "SP053087", "SP053088", "SP053089", "SP053128"],
  },
  {
    key: "dismy-upvc-female-elbow",
    source: `${DISMY_UPLOADS}/2021/12/noi-goc-90-do-ren-trong-dong-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/noi-goc-90-do-ren-trong-dong/",
    skus: ["SP053109"],
  },
  {
    key: "dismy-upvc-straight-coupler",
    source: `${DISMY_UPLOADS}/2022/12/dau-noi-thang-1024x1024.png`,
    sourcePage: "https://cucphuong.com.vn/dau-noi-thang/",
    skus: ["SP053098", "SP053099", "SP053100", "SP053101"],
  },
  {
    key: "dismy-upvc-female-coupler",
    source: `${DISMY_UPLOADS}/2021/12/noi-thang-ren-trong-dong-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/noi-thang-ren-trong-dong/",
    skus: ["SP053246", "SP053322"],
  },
  {
    key: "dismy-upvc-female-adapter",
    source: `${DISMY_UPLOADS}/2021/12/dau-noi-ren-tron-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/dau-noi-thang-ren-trong-dong/",
    skus: ["SP053236"],
  },
  {
    key: "dismy-upvc-pipe",
    source: `${DISMY_UPLOADS}/2021/12/Ong-nong-gioang-pvc.jpg`,
    sourcePage: "https://cucphuong.com.vn/ong-nong-gioang-u-pvc/",
    skus: ["SP053081", "SP053082", "SP053083", "SP053084", "SP053125", "SP053266"],
  },
  {
    key: "dismy-upvc-female-tee",
    source: `${DISMY_UPLOADS}/2021/12/ba-chac-90-do-ren-trong-dong-1024x1024.jpg`,
    sourcePage: "https://cucphuong.com.vn/ba-chac-90-do-ren-trong-3/",
    skus: ["SP053107", "SP053245"],
  },
  {
    key: "dismy-upvc-reducing-tee",
    source: `${DISMY_UPLOADS}/2021/12/Te-thu-PVC1.jpg`,
    sourcePage: "https://cucphuong.com.vn/te-thu-u-pvc/",
    skus: ["SP053117", "SP053118", "SP053264"],
  },
  {
    key: "dismy-upvc-valve",
    source: `${DISMY_UPLOADS}/2021/12/van-nhua-uki-1.jpg`,
    sourcePage: "https://cucphuong.com.vn/van-nhua-u-pvc/",
    skus: ["SP053102"],
  },
  {
    key: "dismy-upvc-y",
    source: `${DISMY_UPLOADS}/2021/12/te-pvc.jpg`,
    sourcePage: "https://cucphuong.com.vn/chu-y-u-pvc/",
    skus: ["SP053262", "SP053263"],
  },

  // Tân Á Đại Thành — Rossi và bồn/máy lọc nước từ gian hàng chính hãng.
  {
    key: "tan-a-rossi-blanc-horizontal",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Rossi-Blanc-ngang.png",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/binh-nong-lanh-gian-tiep-rossi-blanc-ngang-20l/",
    skus: ["SP052888", "SP052936"],
  },
  {
    key: "tan-a-rossi-blanc-square",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Blanc-vuong.png",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/binh-nong-lanh-gian-tiep-rossi-blanc-vuong-15l/",
    skus: ["SP052887"],
  },
  {
    key: "tan-a-rossi-saphir-horizontal",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Saphir-ngang.png",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/binh-nuoc-nong-rossi-saphir-22sl/",
    skus: ["SP002817", "SP002818"],
  },
  {
    key: "tan-a-rossi-saphir-square",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Saphir-vuong.png",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/binh-nuoc-nong-rossi-saphir-16sq/",
    skus: ["SP002815", "SP002816"],
  },
  {
    key: "tan-a-ro-smart",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/08/11.jpg",
    sourcePage:
      "https://shop.tanadaithanh.vn/san-pham/may-loc-nuoc-tan-a-dai-thanh-ro-smart-8-loi/",
    skus: ["SP001862"],
  },
  {
    key: "tan-a-plastic-tank",
    source: "https://shop.tanadaithanh.vn/wp-content/uploads/2025/04/Tan-A-Ex.png",
    sourcePage: "https://shop.tanadaithanh.vn/san-pham/bon-nuoc-nhua-tan-a-ex-500d/",
    skus: ["SP002036"],
  },

  // LiOA — ảnh đại diện chính thức theo từng dòng ổ cắm/thiết bị lắp nổi.
  {
    key: "lioa-tsn",
    source: "https://lioa.com.vn/wp-content/uploads/2025/10/3-4TSN-Anh-dai-dien.webp",
    sourcePage:
      "https://lioa.com.vn/o-cam-keo-dai-thong-dung-loai-co-cong-tac-chinh-hang-lioa-cong-suat-toi-da-5a-220vac-max-1100w-ma-tsn-bao-hanh-2y",
    skus: ["SP000880", "SP000881", "SP000882", "SP000883"],
  },
  {
    key: "lioa-tn",
    source: "https://lioa.com.vn/wp-content/uploads/2025/10/3-4TN-Anh-dai-dien.webp",
    sourcePage: "https://lioa.com.vn/san-pham/page/25/",
    skus: ["SP000884", "SP000885", "SP000886", "SP000887"],
  },
  {
    key: "lioa-surface-mounted",
    source: "https://lioa.com.vn/wp-content/uploads/2025/11/nn.webp",
    sourcePage: "https://lioa.com.vn/thiet-bi-dien-lap-noi-lioa",
    skus: ["SP000877", "SP000878", "SP000879"],
  },
  {
    key: "lioa-heavy-duty-socket",
    source: "https://lioa.com.vn/wp-content/uploads/2025/10/2P-2D-2P-3D-CM.webp",
    sourcePage: "https://lioa.com.vn/san-pham/page/23/",
    skus: ["SP000873", "SP000874", "SP000875"],
  },

  // SENKO và KINGLED — model/dòng sản phẩm được xác nhận trên website hãng.
  {
    key: "senko-l1638",
    source: "https://www.senko.com.vn/media/2087/l1638-01.jpg",
    sourcePage: "https://www.senko.com.vn/san-pham/quat-lo/l1638/",
    skus: ["SP002858"],
  },
  {
    key: "kingled-magnetic-track",
    source:
      "https://kingled.vn/data/Product/5D7367C3-D6C6-4230-9DBF-035327715D48/den-led-ray-nam-cham.jpg",
    sourcePage:
      "https://kingled.vn/den-led-ray-nam-cham-buoc-sang-tao-dot-pha-trong-cong-nghe-chieu-sang",
    skus: ["SP001980", "SP001981"],
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
      headers: { "User-Agent": "LumaPOS product catalog image backfill" },
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

    const path = `official-catalog-2026-07-round-3/${rule.key}.${extensionFor(contentType)}`;
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
