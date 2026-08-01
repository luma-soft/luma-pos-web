import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const imageSources = [
  { sku: "HK-IP-DS2CD1023G2-LIUF", path: "catalog-2026-08/hikvision/ds-2cd1023g2-liuf.png", source: "https://lapdatcameragiare.vn/wp-content/uploads/2025/08/Camera-ip-2mp-hikvision-DS-2CD1023G2-LIUF.png" },
  { sku: "HK-IP-DS2CD1043G2-LIUF", path: "catalog-2026-08/hikvision/ds-2cd1043g2-liuf.png", source: "https://lapdatcameragiare.vn/wp-content/uploads/2025/08/Camera-ip-4mp-hikvision-DS-2CD1043G2-LIUF.png" },
  { sku: "HK-NVR-DS7604NI-K1", path: "catalog-2026-08/hikvision/ds-7604ni-k1.png", source: "https://safebox.sa/cdn/shop/files/1_60cb899f-32a6-49eb-aafe-66d32e601d92.png?v=1728648965" },
  { sku: "HK-NVR-DS7604NI-K1-4P", path: "catalog-2026-08/hikvision/ds-7604ni-k1-4p.png", source: "https://safebox.sa/cdn/shop/files/1_60cb899f-32a6-49eb-aafe-66d32e601d92.png?v=1728648965" },
  { sku: "HK-NVR-DS7608NI-K1", path: "catalog-2026-08/hikvision/ds-7608ni-k1.png", source: "https://safebox.sa/cdn/shop/files/1_7e655d1b-f030-4131-a7ab-d3f1e8ed760e.png?v=1728648990" },
  { sku: "HK-NVR-DS7608NI-K1-8P", path: "catalog-2026-08/hikvision/ds-7608ni-k1-8p.png", source: "https://safebox.sa/cdn/shop/files/1_7e655d1b-f030-4131-a7ab-d3f1e8ed760e.png?v=1728648990" },
  { sku: "HK-SW-DS3E0106P-EM", path: "catalog-2026-08/hikvision/ds-3e0106p-em.png", source: "https://lapdatcameragiare.vn/wp-content/uploads/2025/08/Switch-poe-4-cong-hikvision-DS-3E0106P-EM.png" },
  { sku: "HK-SW-DS3E1310P-EIM", path: "catalog-2026-08/hikvision/ds-3e1310p-eim.png", source: "https://lapdatcameragiare.vn/wp-content/uploads/2025/08/Switch-poe-4-cong-hikvision-DS-3E0106P-EM.png" },
  { sku: "SG-SKYHAWK-1TB", path: "catalog-2026-08/seagate/skyhawk-1tb.webp", source: "https://try.com.ar/wp-content/uploads/2026/03/disco-rigido-hdd-1tb-seagate-skyhawk-3-5-sata.webp" },
  { sku: "SG-SKYHAWK-2TB", path: "catalog-2026-08/seagate/skyhawk-2tb.webp", source: "https://try.com.ar/wp-content/uploads/2026/03/disco-rigido-hdd-1tb-seagate-skyhawk-3-5-sata.webp" },
  { sku: "SG-SKYHAWK-4TB", path: "catalog-2026-08/seagate/skyhawk-4tb.webp", source: "https://try.com.ar/wp-content/uploads/2026/03/disco-rigido-hdd-1tb-seagate-skyhawk-3-5-sata.webp" },
  { sku: "UPS-HIK-650VA", path: "catalog-2026-08/ups/cyberpower-ut650eg.jpg", source: "https://anphat.com.vn/media/product/51702_99.jpg" },
] as const;

async function main() {
  const supabase = createSupabaseAdminClient();

  for (const item of imageSources) {
    const response = await fetch(item.source);
    if (!response.ok) throw new Error(`Không tải được ảnh ${item.sku}: HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) throw new Error(`Ảnh ${item.sku} có content-type không hợp lệ`);

    const { error } = await supabase.storage.from("products").upload(item.path, await response.arrayBuffer(), {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(`Không tải được ảnh ${item.sku} lên Storage: ${error.message}`);

    const { data } = supabase.storage.from("products").getPublicUrl(item.path);
    await db.update(products).set({ imageUrls: [data.publicUrl], updatedAt: new Date() }).where(eq(products.sku, item.sku));
  }

  const synced = await db.select({ sku: products.sku, imageUrls: products.imageUrls }).from(products).where(inArray(products.sku, imageSources.map((item) => item.sku)));
  if (synced.length !== imageSources.length || synced.some((item) => !Array.isArray(item.imageUrls) || item.imageUrls.length === 0)) {
    throw new Error("Đồng bộ ảnh Hikvision chưa đầy đủ");
  }
  console.log(`Đã đồng bộ ảnh cho ${synced.length} sản phẩm Hikvision và phụ kiện.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
