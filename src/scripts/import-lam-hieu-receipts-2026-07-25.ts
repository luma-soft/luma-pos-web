import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  brands,
  categories,
  productSuppliers,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "../db/schema";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

const SUPPLIER_CODE = "NCC-LAM-HIEU";
const WAREHOUSE_NAME = "Kho chính";

const productImageSources = [
  {
    sku: "MEM-IMOU-64GB",
    path: "catalog/imou-st3-64-f1.jpg",
    contentType: "image/jpeg",
    source:
      "https://hanoicomputercdn.com/media/product/69940_the_nho_64gb_chuyen_dung_danh_cho_camera_imou_st3_64_f1.jpg",
  },
  {
    sku: "NET-TENDA-F6",
    path: "catalog/tenda-f6.png",
    contentType: "image/png",
    source:
      "https://static.tenda.com.cn/tdeweb/public/images/product2/636.png",
  },
] as const;

const receipts = [
  {
    code: "PN-DH2607-2115",
    invoiceNumber: "DH26/07-2115",
    createdAt: new Date("2026-07-25T05:00:00.000Z"),
    sourceFile: "IMG_6811.HEIC",
    total: 3_610_000,
    items: [
      { sku: "EZ-H8CP-3MP", supplierSku: "810EZVZ090", quantity: 1, unitCost: 730_000 },
      { sku: "EZ-H6CP-3MP", supplierSku: "810EZVZ095", quantity: 1, unitCost: 405_000 },
      { sku: "EZ-H6CP-5MP", supplierSku: "810EZVZ098", quantity: 2, unitCost: 475_000 },
      { sku: "MEM-IMOU-64GB", supplierSku: "681IMOU003", quantity: 5, unitCost: 250_000 },
      { sku: "NET-TENDA-F6", supplierSku: "700TEDW008", quantity: 1, unitCost: 275_000 },
    ],
  },
  {
    code: "PN-DH2607-2125",
    invoiceNumber: "DH26/07-2125",
    createdAt: new Date("2026-07-26T05:00:00.000Z"),
    sourceFile: "IMG_6812.HEIC",
    total: 30_000,
    items: [
      { sku: "MAT-CAM-JBOX-STD", supplierSku: "818PKCAA001.NV", quantity: 5, unitCost: 6_000 },
    ],
  },
] as const;

async function uploadProductImages() {
  const supabase = createSupabaseAdminClient();
  const urls = new Map<string, string>();

  for (const image of productImageSources) {
    const response = await fetch(image.source);
    if (!response.ok) {
      throw new Error(`Không tải được ảnh ${image.sku}: HTTP ${response.status}`);
    }

    const { error } = await supabase.storage
      .from("products")
      .upload(image.path, await response.arrayBuffer(), {
        contentType: image.contentType,
        upsert: true,
      });
    if (error) throw new Error(`Không tải được ảnh ${image.sku} lên Storage: ${error.message}`);

    const { data } = supabase.storage.from("products").getPublicUrl(image.path);
    urls.set(image.sku, data.publicUrl);
  }

  return urls;
}

async function main() {
  const invoiceNumbers = receipts.map((receipt) => receipt.invoiceNumber);
  const existingReceipts = await db
    .select({ invoiceNumber: purchaseOrders.invoiceNumber })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.invoiceNumber, invoiceNumbers));
  if (existingReceipts.length > 0) {
    throw new Error(
      `Đã tồn tại phiếu: ${existingReceipts.map((receipt) => receipt.invoiceNumber).join(", ")}`,
    );
  }

  const imageUrls = await uploadProductImages();

  await db.transaction(async (tx) => {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.code, SUPPLIER_CODE))
      .limit(1);
    if (!supplier) throw new Error(`Không tìm thấy nhà cung cấp ${SUPPLIER_CODE}`);

    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.name, WAREHOUSE_NAME), eq(warehouses.isDefault, true)))
      .limit(1);
    if (!warehouse) throw new Error(`Không tìm thấy kho mặc định ${WAREHOUSE_NAME}`);

    const [memoryCategory] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, "Thẻ nhớ"))
      .limit(1);
    const [networkCategory] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, "Thiết bị mạng"))
      .limit(1);
    const [imouBrand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.name, "IMOU"))
      .limit(1);
    const [tendaBrand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.name, "Tenda"))
      .limit(1);
    if (!memoryCategory || !networkCategory || !imouBrand || !tendaBrand) {
      throw new Error("Thiếu nhóm hàng hoặc thương hiệu IMOU/Tenda");
    }

    const [memoryCard] = await tx
      .update(products)
      .set({
        name: "Thẻ nhớ IMOU 64GB ST3-64-F1 chuyên dụng cho camera",
        fullName: "Thẻ nhớ IMOU 64GB ST3-64-F1 chuyên dụng cho camera",
        description:
          "Thẻ nhớ microSDXC IMOU ST3-64-F1 dung lượng 64GB, Class 10, chuyên dụng cho camera giám sát và ghi hình liên tục.",
        categoryId: memoryCategory.id,
        brandId: imouBrand.id,
        supplierId: supplier.id,
        costPrice: "250000.00",
        lastPurchasePrice: "250000.00",
        specs: {
          "Mã sản phẩm": ["ST3-64-F1"],
          "Dung lượng": ["64GB"],
          "Chuẩn thẻ": ["microSDXC"],
          "Cấp tốc độ": ["Class 10"],
          "Loại sử dụng": ["Camera giám sát"],
          "Bảo hành": ["24 tháng"],
        },
        imageUrls: [imageUrls.get("MEM-IMOU-64GB")!],
        updatedAt: sql`now()`,
      })
      .where(eq(products.sku, "MEM-IMOU-64GB"))
      .returning({ id: products.id });
    if (!memoryCard) throw new Error("Không tìm thấy sản phẩm MEM-IMOU-64GB");

    const [tendaF6] = await tx
      .insert(products)
      .values({
        sku: "NET-TENDA-F6",
        name: "Router Wi‑Fi Tenda F6 N300",
        fullName: "Router Wi‑Fi Tenda F6 N300 300Mbps 4 anten",
        description:
          "Router Wi‑Fi Tenda F6 chuẩn N300, tốc độ 300Mbps trên băng tần 2.4GHz, 4 anten ngoài 5dBi; hỗ trợ Router, Access Point, WISP và Universal Repeater.",
        categoryId: networkCategory.id,
        brandId: tendaBrand.id,
        supplierId: supplier.id,
        baseUnit: "cái",
        costPrice: "275000.00",
        lastPurchasePrice: "275000.00",
        retailPrice: "350000.00",
        warrantyMonths: 12,
        specs: {
          "Mã sản phẩm": ["F6"],
          "Chuẩn Wi‑Fi": ["IEEE 802.11b/g/n"],
          "Tốc độ": ["300Mbps"],
          "Băng tần": ["2.4GHz"],
          "Anten": ["4 anten ngoài 5dBi"],
          "Cổng mạng": ["1 WAN 10/100Mbps, 3 LAN 10/100Mbps"],
          "Chế độ": ["Router, Access Point, WISP, Universal Repeater"],
          "Nguồn": ["DC 9V/0.6A"],
        },
        imageUrls: [imageUrls.get("NET-TENDA-F6")!],
      })
      .onConflictDoUpdate({
        target: products.sku,
        set: {
          name: "Router Wi‑Fi Tenda F6 N300",
          fullName: "Router Wi‑Fi Tenda F6 N300 300Mbps 4 anten",
          description:
            "Router Wi‑Fi Tenda F6 chuẩn N300, tốc độ 300Mbps trên băng tần 2.4GHz, 4 anten ngoài 5dBi; hỗ trợ Router, Access Point, WISP và Universal Repeater.",
          categoryId: networkCategory.id,
          brandId: tendaBrand.id,
          supplierId: supplier.id,
          costPrice: "275000.00",
          lastPurchasePrice: "275000.00",
          retailPrice: "350000.00",
          warrantyMonths: 12,
          specs: {
            "Mã sản phẩm": ["F6"],
            "Chuẩn Wi‑Fi": ["IEEE 802.11b/g/n"],
            "Tốc độ": ["300Mbps"],
            "Băng tần": ["2.4GHz"],
            "Anten": ["4 anten ngoài 5dBi"],
            "Cổng mạng": ["1 WAN 10/100Mbps, 3 LAN 10/100Mbps"],
            "Chế độ": ["Router, Access Point, WISP, Universal Repeater"],
            "Nguồn": ["DC 9V/0.6A"],
          },
          imageUrls: [imageUrls.get("NET-TENDA-F6")!],
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: products.id });

    const allSkus = receipts.flatMap((receipt) => receipt.items.map((item) => item.sku));
    const productRows = await tx
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(inArray(products.sku, allSkus));
    const productBySku = new Map(productRows.map((product) => [product.sku, product.id]));
    productBySku.set("NET-TENDA-F6", tendaF6.id);

    const missingSkus = [...new Set(allSkus)].filter((sku) => !productBySku.has(sku));
    if (missingSkus.length > 0) {
      throw new Error(`Không tìm thấy sản phẩm: ${missingSkus.join(", ")}`);
    }

    for (const receipt of receipts) {
      const calculatedTotal = receipt.items.reduce(
        (sum, item) => sum + item.quantity * item.unitCost,
        0,
      );
      if (calculatedTotal !== receipt.total) {
        throw new Error(`Tổng tiền ${receipt.invoiceNumber} không khớp ảnh phiếu`);
      }

      const [purchase] = await tx
        .insert(purchaseOrders)
        .values({
          code: receipt.code,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          status: "received",
          subtotal: receipt.total.toFixed(2),
          discount: "0.00",
          vatRate: "0.00",
          tax: "0.00",
          total: receipt.total.toFixed(2),
          amountPaid: receipt.total.toFixed(2),
          invoiceNumber: receipt.invoiceNumber,
          note: `Nhập hồi tố tồn kho từ ${receipt.sourceFile}; phiếu đã thanh toán tiền mặt ngoài hệ thống, không ghi sổ quỹ.`,
          createdAt: receipt.createdAt,
        })
        .returning({ id: purchaseOrders.id });

      for (const item of receipt.items) {
        const productId = productBySku.get(item.sku)!;
        const quantity = item.quantity.toFixed(4);
        const unitCost = item.unitCost.toFixed(2);
        const lineTotal = (item.quantity * item.unitCost).toFixed(2);

        await tx.insert(purchaseOrderItems).values({
          purchaseOrderId: purchase.id,
          productId,
          quantity,
          unitCost,
          discount: "0.00",
          total: lineTotal,
        });

        await tx
          .insert(stockLevels)
          .values({ productId, warehouseId: warehouse.id, quantity })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} + ${quantity}`,
              updatedAt: sql`now()`,
            },
          });

        await tx.insert(stockMovements).values({
          productId,
          warehouseId: warehouse.id,
          type: "purchase",
          quantity,
          unitCost,
          refType: "purchase",
          refId: purchase.id,
          note: `${receipt.code} • ${receipt.invoiceNumber}`,
          createdAt: receipt.createdAt,
        });

        await tx
          .update(products)
          .set({
            supplierId: supplier.id,
            costPrice: unitCost,
            lastPurchasePrice: unitCost,
            updatedAt: sql`now()`,
          })
          .where(eq(products.id, productId));

        await tx
          .insert(productSuppliers)
          .values({
            productId,
            supplierId: supplier.id,
            isPrimary: true,
            supplierSku: item.supplierSku,
            costPrice: unitCost,
          })
          .onConflictDoUpdate({
            target: [productSuppliers.productId, productSuppliers.supplierId],
            set: {
              isPrimary: true,
              supplierSku: item.supplierSku,
              costPrice: unitCost,
            },
          });
      }
    }
  });

  console.log(`Đã nhập ${receipts.length} phiếu: ${invoiceNumbers.join(", ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
