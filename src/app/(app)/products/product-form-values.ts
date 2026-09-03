import type { ProductDetail } from "@/lib/data/products";
import { parseProductImagePublicUrl } from "@/lib/images/product-image-coordinate";
import type { PublicMediaConfig } from "@/lib/media/config";
import type { CreateProductInput } from "./new/schema";

type ProductSeedMode = "edit" | "copy" | "sameType";
const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

export function productToFormInitialValues(
  product: ProductDetail,
  mode: ProductSeedMode = "edit",
  priceBookPrices: Record<string, string | number | null | undefined> = {},
  publicMedia?: PublicMediaConfig,
): Partial<CreateProductInput> {
  const specs = (product.specs as Record<string, string[]> | null) ?? {};
  const orderNote = specs[PRODUCT_ORDER_NOTE_SPEC_KEY]?.[0] ?? "";
  const attributeSpecs = Object.entries(specs).filter(
    ([name]) => name !== PRODUCT_ORDER_NOTE_SPEC_KEY,
  );
  const imageMedia = product.imageMedia ?? [];
  const shared: Partial<CreateProductInput> = {
    productKind: product.productKind,
    categoryId: product.categoryId ?? "",
    brandId: product.brandId ?? "",
    supplierIds: product.suppliers.map((s) => s.id),
    baseUnit: product.baseUnit,
    costPrice: Number(product.costPrice),
    retailPrice: Number(product.retailPrice),
    wholesalePrice:
      product.wholesalePrice != null ? Number(product.wholesalePrice) : null,
    contractorPrice:
      product.contractorPrice != null ? Number(product.contractorPrice) : null,
    agentPrice: product.agentPrice != null ? Number(product.agentPrice) : null,
    priceBookPrices: Object.fromEntries(
      Object.entries(priceBookPrices).map(([bookId, price]) => [
        bookId,
        price != null ? Number(price) : null,
      ]),
    ),
    units: product.units.map((u) => ({
      id: mode === "edit" ? u.id : undefined,
      unitName: u.unitName,
      multiplier: Number(u.multiplier),
      barcode: mode === "copy" ? "" : (u.barcode ?? ""),
      priceOverride: u.priceOverride != null ? Number(u.priceOverride) : null,
    })),
    comboItems: product.comboItems.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
    })),
    attributes: attributeSpecs.map(([name, values]) => ({
      name,
      values: Array.isArray(values) ? values : [String(values)],
      createsVariants: false,
    })),
  };

  if (mode === "sameType") {
    return {
      ...shared,
      sku: "",
      barcode: "",
      name: "",
      imageUrls: [],
      location: product.location ?? "",
      description: "",
      invoiceNote: "",
      directSale: true,
      initialStock: 0,
    };
  }

  return {
    ...shared,
    sku: mode === "copy" ? "" : product.sku,
    barcode: mode === "copy" ? "" : (product.barcode ?? ""),
    name: product.name,
    imageUrls: mode === "copy"
      ? (product.imageUrls ?? []).filter(
          (url) =>
            (!publicMedia || !parseProductImagePublicUrl(url, publicMedia))
            && !imageMedia.some((image) => image.url === url),
        )
      : product.imageUrls ?? [],
    imageMediaIds: mode === "edit"
      ? imageMedia.map((image) => image.mediaId)
      : [],
    location: product.location ?? "",
    description: product.description ?? "",
    invoiceNote: orderNote,
    directSale: product.isActive,
    initialStock: 0,
    ...(mode === "edit" ? { currentStock: Number(product.totalStock ?? 0) } : {}),
  };
}
