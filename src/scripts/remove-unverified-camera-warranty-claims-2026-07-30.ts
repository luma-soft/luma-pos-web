import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brands, categories, products } from "../db/schema";
import { buildCameraProductDescription } from "./camera-product-description";

const CARD_SKUS = ["MEM-HIK-32GB", "MEM-IMOU-64GB"] as const;
const CAMERA_BRANDS = ["EZVIZ", "IMOU"] as const;
const CARD_DESCRIPTION =
  "Thẻ nhớ chuyên dụng cho camera, dùng ghi hình liên tục hoặc theo sự kiện.";

function readSpec(specs: unknown, name: string) {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) {
    throw new Error(`Bảng thông số không hợp lệ; thiếu “${name}”.`);
  }
  const value = (specs as Record<string, unknown>)[name];
  if (!Array.isArray(value) || typeof value[0] !== "string" || !value[0].trim()) {
    throw new Error(`Thiếu thông số “${name}”.`);
  }
  return value[0];
}

async function main() {
  const cameraRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      specs: products.specs,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        inArray(brands.name, [...CAMERA_BRANDS]),
        eq(categories.name, "Camera giám sát"),
      ),
    );

  const cardRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      specs: products.specs,
    })
    .from(products)
    .where(inArray(products.sku, [...CARD_SKUS]));

  if (cardRows.length !== CARD_SKUS.length) {
    const found = new Set(cardRows.map((row) => row.sku));
    throw new Error(
      `Thiếu sản phẩm thẻ nhớ: ${CARD_SKUS.filter((sku) => !found.has(sku)).join(", ")}`,
    );
  }

  await db.transaction(async (tx) => {
    for (const camera of cameraRows) {
      const description = buildCameraProductDescription({
        name: camera.name,
        fullCode: readSpec(camera.specs, "Mã đầy đủ"),
        resolution: readSpec(camera.specs, "Độ phân giải"),
        lens: readSpec(camera.specs, "Ống kính / góc nhìn"),
        connection: readSpec(camera.specs, "Kết nối"),
        nightAndProtection: readSpec(camera.specs, "Ban đêm / bảo vệ"),
        powerAndStorage: readSpec(camera.specs, "Nguồn / lưu trữ"),
        features: readSpec(camera.specs, "Tính năng chính"),
      });
      await tx
        .update(products)
        .set({
          description,
          warrantyMonths: 0,
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, camera.id));
    }

    for (const card of cardRows) {
      const specs =
        card.specs && typeof card.specs === "object" && !Array.isArray(card.specs)
          ? { ...(card.specs as Record<string, unknown>) }
          : {};
      delete specs["Bảo hành"];
      await tx
        .update(products)
        .set({
          description: CARD_DESCRIPTION,
          specs,
          warrantyMonths: 0,
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, card.id));
    }
  });

  const verification = await db
    .select({
      sku: products.sku,
      description: products.description,
      warrantyMonths: products.warrantyMonths,
      specs: products.specs,
    })
    .from(products)
    .where(inArray(products.sku, [...CARD_SKUS]));

  const invalidCards = verification.filter((card) => {
    const specs =
      card.specs && typeof card.specs === "object" && !Array.isArray(card.specs)
        ? (card.specs as Record<string, unknown>)
        : {};
    return (
      card.description !== CARD_DESCRIPTION ||
      card.warrantyMonths !== 0 ||
      "Bảo hành" in specs
    );
  });
  if (invalidCards.length) {
    throw new Error(
      `Metadata thẻ nhớ chưa được sửa: ${invalidCards.map((row) => row.sku).join(", ")}`,
    );
  }

  const cameraVerification = await db
    .select({
      sku: products.sku,
      description: products.description,
      warrantyMonths: products.warrantyMonths,
    })
    .from(products)
    .where(inArray(products.id, cameraRows.map((row) => row.id)));
  const invalidCameras = cameraVerification.filter(
    (camera) =>
      camera.warrantyMonths !== 0 ||
      /bảo hành\s*:\s*24 tháng/i.test(camera.description ?? ""),
  );
  if (invalidCameras.length) {
    throw new Error(
      `Camera còn claim bảo hành chưa xác minh: ${invalidCameras
        .map((row) => row.sku)
        .join(", ")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        camerasCleared: cameraRows.length,
        cardsCorrected: verification.length,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
