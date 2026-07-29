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
  // Apollo Silicone — trang chính thức dùng chung ảnh A500 cho các màu sản phẩm.
  {
    key: "apollo-silicone-a300",
    source:
      "https://static.quochuyanhcorp.vn/17328/sp/ver2-apollo-a300.jpg",
    sourcePage:
      "https://apollosilicone.vn/san-pham/keo-silicon-apollo-silicone-sealant-a300",
    skus: ["SP000593"],
  },
  {
    key: "apollo-silicone-a500",
    source:
      "https://static.quochuyanhcorp.vn/17329/sp/ver2-apollo-a500.jpg",
    sourcePage:
      "https://apollosilicone.vn/san-pham/keo-silicon-apollo-silicone-sealant-a500",
    skus: ["SP000594", "SP000595", "SP000596", "SP000597"],
  },

  // Eurofire — ảnh đúng model từ website chính thức.
  {
    key: "eurofire-ief001",
    source:
      "https://eurofire.vn/wp-content/uploads/2021/07/IEF-001-scaled.jpg",
    sourcePage: "https://eurofire.vn/?s=IEF001",
    skus: ["SP001735"],
  },
  {
    key: "eurofire-ief008",
    source:
      "https://eurofire.vn/wp-content/uploads/2023/03/IEF008-scaled.jpg",
    sourcePage: "https://eurofire.vn/?s=IEF008",
    skus: ["SP001736"],
  },
  {
    key: "eurofire-ef014",
    source:
      "https://eurofire.vn/wp-content/uploads/2025/02/Anh-phoi-canh-EF014-Slim-.1-1.png",
    sourcePage: "https://eurofire.vn/san-pham/may-hut-mui-ef014/",
    skus: ["SP001734"],
  },

  // Krasic — ảnh đúng model từ catalog của nhà phân phối chính thức.
  {
    key: "krasic-k8020",
    source: "https://krasic.vn/wp-content/uploads/2022/02/15.png",
    sourcePage: "https://krasic.vn/?s=K8020&post_type=product",
    skus: ["SP001951"],
  },
  {
    key: "krasic-pk02w",
    source: "https://krasic.vn/wp-content/uploads/2022/06/2-2.jpg",
    sourcePage: "https://krasic.vn/?s=PK02W&post_type=product",
    skus: ["SP001940"],
  },
  {
    key: "krasic-pk01w",
    source:
      "https://krasic.vn/wp-content/uploads/2022/06/z3461191504246_f32934ebc5c1a16aab88c9159b8af611.jpg",
    sourcePage: "https://krasic.vn/?s=PK01W&post_type=product",
    skus: ["SP001941"],
  },
  {
    key: "krasic-k06007",
    source: "https://krasic.vn/wp-content/uploads/2024/03/Cover-K06007.png",
    sourcePage: "https://krasic.vn/?s=K06007&post_type=product",
    skus: ["SP001932"],
  },
  {
    key: "krasic-k06731f",
    source: "https://krasic.vn/wp-content/uploads/2022/09/06731f.png",
    sourcePage: "https://krasic.vn/?s=K06731F&post_type=product",
    skus: ["SP001934"],
  },
  {
    key: "krasic-k06738f",
    source: "https://krasic.vn/wp-content/uploads/2023/03/7-1.png",
    sourcePage: "https://krasic.vn/?s=K06738F&post_type=product",
    skus: ["SP001933"],
  },
  {
    key: "krasic-pk03w",
    source: "https://krasic.vn/wp-content/uploads/2022/06/3-1.jpg",
    sourcePage: "https://krasic.vn/?s=PK03W&post_type=product",
    skus: ["SP001939"],
  },
  {
    key: "krasic-pk05w",
    source: "https://krasic.vn/wp-content/uploads/2022/06/5-2.jpg",
    sourcePage: "https://krasic.vn/?s=PK05W&post_type=product",
    skus: ["SP001942"],
  },
  {
    key: "krasic-kh7080",
    source: "https://krasic.vn/wp-content/uploads/2023/03/9.jpg",
    sourcePage: "https://krasic.vn/?s=KH7080&post_type=product",
    skus: ["SP001937"],
  },
  {
    key: "krasic-kh7072",
    source: "https://krasic.vn/wp-content/uploads/2023/03/8-1.jpg",
    sourcePage: "https://krasic.vn/?s=KH7072&post_type=product",
    skus: ["SP001936"],
  },
  {
    key: "krasic-ks7084g",
    source: "https://krasic.vn/wp-content/uploads/2021/11/18.jpg",
    sourcePage: "https://krasic.vn/?s=KS7084G&post_type=product",
    skus: ["SP002985"],
  },
  {
    key: "krasic-ks7088",
    source: "https://krasic.vn/wp-content/uploads/2021/11/20.jpg",
    sourcePage: "https://krasic.vn/?s=KS7088&post_type=product",
    skus: ["SP001935"],
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

    const path = `official-catalog-2026-07-round-5/${rule.key}.${extensionFor(contentType)}`;
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
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
