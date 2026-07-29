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

const SINO_S19_PAGE = "https://sino.com.vn/dong-full-color-2-1-419435-p1.html";
const SINO_S18_PAGE = "https://sino.com.vn/dong-cosmo-art-2-1-409805-p1.html";
const SINO_CONDUIT_PAGE = "https://sino.com.vn/ong-sp-2-1-430880.html";
const SINO_FLEX_PAGE =
  "https://sino.com.vn/ong-dan-hoi-va-ong-dieu-hoa-2-1-433046.html";
const SINO_E4FC_PAGE = "https://sino.com.vn/nap-ba-2-1-419451.html";
const SINO_CDN =
  "https://cdn-img-v2.mybota.vn/uploadv2/web/11/11232/product";

const imageRules: readonly ImageRule[] = [
  // Sino S19 — mã trong tên hàng được đối chiếu trực tiếp với catalog hãng.
  {
    key: "sino-s19-a96-1-2m",
    source: `${SINO_CDN}/2026/07/25/10/03/1784946513_a96-1-2m.png?v=4`,
    sourcePage: SINO_S19_PAGE,
    skus: ["SP002916"],
  },
  {
    key: "sino-s19-a96m",
    source: `${SINO_CDN}/2026/07/25/10/20/1784947497_a96m.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-full-color-2-1-419435-p4.html",
    skus: ["SP002917"],
  },
  {
    key: "sino-s19-a96md20",
    source: `${SINO_CDN}/2026/07/25/10/36/1784948459_a96md20.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-full-color-2-1-419435-p4.html",
    skus: ["SP002918"],
  },
  {
    key: "sino-s19-a96nrd",
    source: `${SINO_CDN}/2026/07/25/10/50/1784949332_a96nrd.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-full-color-2-1-419435-p5.html",
    skus: ["SP002919"],
  },
  {
    key: "sino-s19-a96rj88",
    source: `${SINO_CDN}/2026/07/25/11/01/1784949980_a96rj886---88---40.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-full-color-2-1-419435-p6.html",
    skus: ["SP002920"],
  },
  {
    key: "sino-s19-a96x",
    source: `${SINO_CDN}/2026/07/25/10/54/1784949568_a96x.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-full-color-2-1-419435-p5.html",
    skus: ["SP002921"],
  },
  ...[
    ["s190", "2021/05/13/12/40/1620874209_s190.png", "SP002915", "2"],
    ["s191", "2021/05/13/01/07/1620875839_s191.png", "SP002911", "1"],
    ["s192", "2021/05/13/01/06/1620875736_s192.png", "SP002909", "1"],
    ["s193", "2021/05/13/01/03/1620875615_s193.png", "SP002910", "1"],
    ["s194", "2021/05/13/01/01/1620875475_s194.png", "SP002912", "1"],
    ["s195", "2021/05/13/12/56/1620875195_s195.png", "SP002913", "2"],
    ["s196", "2021/05/13/12/52/1620874938_s196.png", "SP002914", "2"],
    ["s198x", "2021/05/13/01/57/1620878847_s198x.png", "SP002925", "2"],
    ["s198xx", "2021/05/13/01/52/1620878510_s198xx.png", "SP002926", "2"],
    ["s1981e", "2021/05/13/01/31/1620877248_s1981e.png", "SP002927", "3"],
    ["s1982", "2021/05/13/02/15/1620879882_s1982.png", "SP002928", "1"],
    ["s1982x", "2021/05/13/01/48/1620878288_s1982x.png", "SP002907", "2"],
    ["s1982xx", "2021/05/13/01/45/1620878131_s1982xx.png", "SP002908", "2"],
    ["s1982e", "2021/05/13/01/29/1620877120_s1982e.png", "SP002930", "3"],
    ["s1983", "2021/05/13/02/10/1620879597_s1983.png", "SP002929", "1"],
  ].map(([model, path, sku, page]) => ({
    key: `sino-s19-${model}`,
    source: `${SINO_CDN}/${path}?v=4`,
    sourcePage: `https://sino.com.vn/dong-full-color-2-1-419435-p${page}.html`,
    skus: [sku],
  })),

  // Sino S18 — ảnh đúng mã/mặt/ổ cắm từ catalog hãng.
  {
    key: "sino-s18-switch-1-way",
    source: `${SINO_CDN}/2019/12/03/02/43/1575341031_s181d1---s181d2.png?v=4`,
    sourcePage: SINO_S18_PAGE,
    skus: ["SP000916"],
  },
  {
    key: "sino-s18-switch-2-way",
    source: `${SINO_CDN}/2019/12/03/02/47/1575341240_s181d1---s181d2.png?v=4`,
    sourcePage: "https://sino.com.vn/dong-cosmo-art-2-1-409805-p2.html",
    skus: ["SP000917"],
  },
  ...[
    ["face-1", "2021/05/07/04/29/1620369907_s181x.png", "SP000918"],
    ["face-2", "2021/05/07/04/39/1620370504_s182x.png", "SP000919"],
    ["face-3", "2021/05/07/04/44/1620370809_s183x.png", "SP000920"],
    ["socket-u", "2021/05/10/04/17/1620628218_s18u.png", "SP000922"],
    ["socket-u-x", "2021/05/10/04/38/1620629475_s18ux.png", "SP000921"],
    ["socket-ue", "2021/05/10/04/49/1620630149_s18ue.png", "SP000923"],
    ["socket-u2-x", "2021/05/10/04/43/1620629734_s18u2x.png", "SP000924"],
    ["socket-u2-xx", "2021/05/10/04/47/1620629980_s18u2xx.png", "SP000925"],
    ["socket-ue2", "2021/05/10/04/55/1620630498_s18ue2.png", "SP000926"],
    ["st121-m", "2019/12/04/03/15/1575429341_st121-m.png", "SP002923"],
    ["st122-m", "2019/12/04/03/10/1575429055_st122-m.png", "SP002922"],
    ["st121-ha", "2019/12/04/02/55/1575428136_st121-ha.png", "SP002219"],
    ["st121-hb", "2019/12/04/02/49/1575427777_st121-hb.png", "SP002924"],
  ].map(([key, path, sku]) => ({
    key: `sino-s18-${key}`,
    source: `${SINO_CDN}/${path}?v=4`,
    sourcePage: SINO_S18_PAGE,
    skus: [sku],
  })),
  {
    key: "sino-s18-double-switch",
    source: `${SINO_CDN}/2022/10/15/07/50/1665808944_s18ccs-2s.png?v=4`,
    sourcePage: "https://sino.com.vn/cong-tac-kep-s18ccs2s-1-1-1444514.html",
    skus: ["SP001923"],
  },

  // Sino ống luồn, phụ kiện và tủ điện: cùng kích cỡ dùng ảnh dòng sản phẩm.
  {
    key: "sino-conduit-sp",
    source: `${SINO_CDN}/2019/06/11/02/18/1560219522_ong-tron2.png?v=4`,
    sourcePage: SINO_CONDUIT_PAGE,
    skus: ["SP000888", "SP000889", "SP000890", "SP001902"],
  },
  {
    key: "sino-flexible-conduit",
    source: `${SINO_CDN}/2019/06/14/02/12/1560478358_dan-hoi.png?v=4`,
    sourcePage: SINO_FLEX_PAGE,
    skus: ["SP000891", "SP000892", "SP000893", "SP053001"],
  },
  {
    key: "sino-conduit-straight-coupler",
    source: `${SINO_CDN}/2026/03/14/01/17/1773467913_khop-noi-tron-1.png?v=4`,
    sourcePage: SINO_CONDUIT_PAGE,
    skus: ["SP000901", "SP000902", "SP000903", "SP001899"],
  },
  {
    key: "sino-conduit-threaded-coupler",
    source: `${SINO_CDN}/2026/03/14/03/40/1773476471_khop-noi-ren--dau-van-1.png?v=4`,
    sourcePage: SINO_CONDUIT_PAGE,
    skus: ["SP000904", "SP000905", "SP000906"],
  },
  {
    key: "sino-conduit-clamp",
    source: `${SINO_CDN}/2019/06/12/07/56/1560326213_kep-do-v.png?v=4`,
    sourcePage: SINO_CONDUIT_PAGE,
    skus: ["SP002492", "SP000899", "SP000900", "SP001901"],
  },
  ...[
    ["2-4", "2019/06/13/08/35/1560414957_e4fc2-4.png", "SP000912"],
    ["3-6", "2019/06/13/08/49/1560415757_e4fc3-6.png", "SP000913"],
    ["4-8", "2019/06/13/08/52/1560415975_e4fc4-8-1.png", "SP000914"],
    ["8-12", "2022/11/10/11/11/1668065786_e4fc-8-12-de-sat.png", "SP000915"],
  ].map(([model, path, sku]) => ({
    key: `sino-e4fc-${model}`,
    source: `${SINO_CDN}/${path}?v=4`,
    sourcePage: SINO_E4FC_PAGE,
    skus: [sku],
  })),

  // CADI-SUN và Trần Phú — catalog hãng quản lý theo kết cấu 1 lõi/2 lõi.
  {
    key: "cadisun-vcsf-1x",
    source:
      "https://www.cadisun.com.vn/FileManager/2024/Hinh%20anh%20thay%20the/San%20pham/VCSF.png",
    sourcePage:
      "https://www.cadisun.com.vn/san-pham/day-dien-dan-dung/day-don-memvcsf-1xaspx.aspx",
    skus: [
      "SP003031",
      "SP003032",
      "SP003033",
      "SP003034",
      "SP053045",
      "SP053046",
      "SP003035",
      "SP003036",
    ],
  },
  {
    key: "cadisun-vcmd-2x",
    source:
      "https://www.cadisun.com.vn/FileManager/SanPham/DAY%20DAN%20DUNG%20XE%20MAY/VCMD%202x0,75%203.png",
    sourcePage:
      "https://www.cadisun.com.vn/san-pham/day-dien-dan-dung/day-xup-dinhvcmd-2xaspx.aspx",
    skus: ["SP003037", "SP003038", "SP003039", "SP003040", "SP003041", "SP003042"],
  },
  {
    key: "tran-phu-domestic-wire",
    source:
      "https://www.tranphucable.com.vn/uploads/images/images/day-dien-tran-phu-1_5.jpg",
    sourcePage:
      "https://www.tranphucable.com.vn/tin-thi-truong/phan-loai-day-dien-tran-phu-15-va-mot-so-luu-y-khi-mua-day-dan-dien",
    skus: [
      "SP003019",
      "SP003020",
      "SP003021",
      "SP003022",
      "SP052905",
      "SP003023",
      "SP003024",
      "SP003025",
      "SP003026",
      "SP003027",
      "SP003028",
      "SP003029",
      "SP003030",
    ],
  },

  // INAX — ảnh sản phẩm chính thức theo đúng model.
  {
    key: "inax-ac-959",
    source:
      "https://s3-ap-southeast-1.amazonaws.com/inax-vn/sanitary/products/AC-959VAN.png",
    sourcePage: "https://www.inax.com.vn/vi/san-pham/ban-cau-1-khoi/",
    skus: ["SP002830"],
  },
  {
    key: "inax-ac-969",
    source:
      "https://inax-vn.s3-ap-southeast-1.amazonaws.com/sanitary/products/AC-969VN+(1).png",
    sourcePage: "https://www.inax.com.vn/vi/product-category/394/",
    skus: ["SP002831"],
  },
  {
    key: "inax-ac-989",
    source:
      "https://inax-vn.s3.ap-southeast-1.amazonaws.com/sanitary/products/AC-989VN_photo.png",
    sourcePage: "https://www.inax.com.vn/product-category/ban-cau-1-khoi/",
    skus: ["SP002832"],
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

    const path = `official-catalog-2026-07-round-2/${rule.key}.${extensionFor(contentType)}`;
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
