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

const imageRules: readonly ImageRule[] = [
  // SUNHOUSE — ảnh đúng model từ website chính thức.
  {
    key: "sunhouse-apf7668w",
    source: "https://sunhouse.com.vn/pic/product/500x600(350).jpg",
    sourcePage:
      "https://sunhouse.com.vn/dien-gia-dung/quat-tran/quat-tran-5-canh-sunhouse-apex-apf7668w.html",
    skus: ["SP002802"],
  },

  // Phong Lan/HAPEMCO — ảnh đúng model từ website nhà sản xuất.
  {
    key: "phong-lan-d450-5c",
    source:
      "https://hapemco.vn/uploaded/san-pham/phong-lan/%C4%90450-5C.jpg",
    sourcePage:
      "https://hapemco.vn/quat-phong-lan/quat-dung-450-5-canh-do.html",
    skus: ["SP002857", "SP002020"],
  },
  {
    key: "phong-lan-t300",
    source: "https://hapemco.vn/uploaded/san-pham/phong-lan/T-300.jpg",
    sourcePage: "https://hapemco.vn/quat-treo-tuong/quat-treo-300.html",
    skus: ["SP001924"],
  },
  {
    key: "phong-lan-t400dk",
    source: "https://hapemco.vn/uploaded/san-pham/phong-lan/T-400DK.jpg",
    sourcePage:
      "https://hapemco.vn/quat-treo-tuong/quat-treo-400-dieu-khien.html",
    skus: ["SP002019"],
  },
  {
    key: "phong-lan-ht200",
    source: "https://hapemco.vn/uploaded/san-pham/phong-lan/HT-200.jpg",
    sourcePage: "https://hapemco.vn/quat-hut/quat-hut-200.html",
    skus: ["SP002234"],
  },
  {
    key: "phong-lan-ht250",
    source: "https://hapemco.vn/uploaded/san-pham/phong-lan/HT-250.jpg",
    sourcePage: "https://hapemco.vn/quat-hut/quat-hut-250.html",
    skus: ["SP002235"],
  },

  // GENUN — ảnh đúng model từ nhà bán lẻ chuyên quạt Quattico.
  {
    key: "genun-apb15b3",
    source:
      "https://bizweb.dktcdn.net/100/046/374/products/genun-apb15b3.jpg",
    sourcePage:
      "https://quattico.com/quat-thong-gio-gan-tuong-genun-apb15b3",
    // APB15B3 có ô chờ 20x20 cm nên dùng cho tên rút gọn "âm trần 20x20".
    skus: ["SP002931", "SP002763"],
  },
  {
    key: "genun-apb20b3",
    source:
      "https://bizweb.dktcdn.net/100/046/374/products/genun-apb15b3-1b8dab9c-a660-433d-a9d2-6d55384654a4.jpg",
    sourcePage:
      "https://quattico.com/quat-thong-gio-gan-tuong-genun-apb20b3",
    // APB20B3 có ô chờ 25x25 cm.
    skus: ["SP002932", "SP002764"],
  },
  {
    key: "genun-apb25b3",
    source:
      "https://bizweb.dktcdn.net/100/046/374/products/genun-apb15b3-1b8dab9c-a660-433d-a9d2-6d55384654a4-848871a2-6fcf-4e27-9ab7-012a9b101be1.jpg",
    sourcePage:
      "https://quattico.com/quat-thong-gio-gan-tuong-genun-apb25b3",
    // APB25B3 có ô chờ 30x30 cm.
    skus: ["SP002933", "SP002765"],
  },
  {
    key: "genun-apb30b3",
    source:
      "https://bizweb.dktcdn.net/100/046/374/products/genun-apb15b3-1b8dab9c-a660-433d-a9d2-6d55384654a4-848871a2-6fcf-4e27-9ab7-012a9b101be1-0fb4e2b1-9c73-49c7-8c54-cd4986013f16.jpg",
    sourcePage:
      "https://quattico.com/quat-thong-gio-gan-tuong-genun-apb30b3",
    skus: ["SP002934"],
  },

  // Maxben M162 — trang sản phẩm xác nhận model và từng màu hoàn thiện.
  {
    key: "maxben-m162-wood",
    source:
      "https://duled.vn/wp-content/uploads/2026/02/Background-Eraser-81-1-scaled-1.jpeg",
    sourcePage: "https://duled.vn/quat-tran-maxben-m162/",
    skus: ["SP002833"],
  },
  {
    key: "maxben-m162-silver",
    source:
      "https://duled.vn/wp-content/uploads/2026/02/background-eraser-80-1-scaled-1.jpeg",
    sourcePage: "https://duled.vn/quat-tran-maxben-m162/",
    skus: ["SP001928"],
  },

  // Phụ kiện ốp lát — ảnh phân loại rõ sản phẩm và kích thước.
  {
    key: "tile-leveling-clip",
    source:
      "https://cdn.hstatic.net/products/200001053363/ke-lat-gach-moi_cba03b60eaf34caa82e6d59e3355d178_0db8232ae91a467d95d362254964908d.png",
    sourcePage: "https://vatlieuthongminh.vn/products/ke-can-bang-gach-1",
    skus: ["SP002007", "SP002008", "SP002009"],
  },
  {
    key: "tile-leveling-wedge",
    source:
      "https://cdn.hstatic.net/products/200001053363/ke-nhua-can-bang_65718108fac3439f97e3159975c8475d_0d3d138c1a47492b9ded05ac0b141fc0_grande.jpg",
    sourcePage:
      "https://vatlieuthongminh.vn/products/nem-can-bang-gach-chot-gai-1",
    skus: ["SP002010"],
  },
  {
    key: "tile-leveling-pliers",
    source:
      "https://hongtamphat.com/wp-content/uploads/2024/09/kim-bop-ke-can-bang.png",
    sourcePage: "https://hongtamphat.com/san-pham/kiem-siet-ke/",
    skus: ["SP002011"],
  },
  {
    key: "tile-cross-spacer",
    source:
      "https://thietbivesinhso1.com/uploads/products/keo-dan-gach/ke-nhua/ke-nhua-chu-thap-2.jpg",
    sourcePage: "https://thietbivesinhso1.com/ke-nhua-chu-thap-2",
    skus: ["SP002004", "SP002005", "SP002006"],
  },

  // Sơn Hải Phòng — ảnh bao bì dòng chống rỉ Alkyd từ nhà bán lẻ chuyên sơn.
  {
    key: "son-hai-phong-alkyd-primer",
    source:
      "https://sonketcauthep.com/wp-content/uploads/2023/03/son-chong-ri-alkyd-hai-phong-1.jpg",
    sourcePage:
      "https://sonketcauthep.com/san-pham/son-chong-ri-alkyd-hai-phong/",
    skus: ["SP001286", "SP001418", "SP001419", "SP001420", "SP002998", "SP002719"],
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

    const path = `catalog-2026-07-round-6/${rule.key}.${extensionFor(contentType)}`;
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
    `Đã bổ sung và xác minh ${verified.length} sản phẩm bằng ${usedRules.length} ảnh.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
