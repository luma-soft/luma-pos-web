import type { ProductDetail } from "@/lib/data/products";
import { parseProductImagePublicUrl } from "@/lib/images/product-image-coordinate";
import type { PublicMediaConfig } from "@/lib/media/config";
import type { CreateProductInput } from "./new/schema";
import { buildVariantCombinations, normalizeVariantAttributes, variantCombinationBudget } from "@/lib/products/variant-model";

export type ProductSeedMode = "edit" | "copy" | "groupCopy" | "sameType" | "groupEdit" | "groupAdd";
const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

/** Group forms must seed shared fields from the real root, never a child override. */
export async function resolveProductFormSeed(
  product: ProductDetail,
  mode: ProductSeedMode,
  loadProduct: (id: string) => Promise<ProductDetail | null>,
): Promise<ProductDetail | null> {
  const groupMode = mode === "groupCopy" || mode === "groupEdit" || mode === "groupAdd" || mode === "sameType";
  const groupId = product.variantGroup?.id;
  if (!groupMode || !groupId || groupId === product.id) return product;
  const root = await loadProduct(groupId);
  return root?.id === groupId ? root : null;
}

export function productToFormInitialValues(
  product: ProductDetail,
  mode: ProductSeedMode = "edit",
  priceBookPrices: Record<string, string | number | null | undefined> = {},
  publicMedia?: PublicMediaConfig,
): Partial<CreateProductInput> {
  const isCopy = mode === "copy" || mode === "groupCopy";
  const specs = (product.specs as Record<string, string[]> | null) ?? {};
  const orderNote = specs[PRODUCT_ORDER_NOTE_SPEC_KEY]?.[0] ?? "";
  const attributeSpecs = Object.entries(specs).filter(
    ([name]) => !name.startsWith("__"),
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
      barcode: isCopy ? "" : (u.barcode ?? ""),
      priceOverride: u.priceOverride != null ? Number(u.priceOverride) : null,
    })),
    comboItems: product.comboItems.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
    })),
    attributes: attributeSpecs.map(([name, values]) => ({
      name,
      values: Array.isArray(values) ? values : [String(values)],
      createsVariants: mode !== "edit",
    })),
  };

  const group = product.variantGroup;
  const groupEditing = mode === "groupEdit" || mode === "groupAdd" || mode === "sameType" || (mode === "edit" && product.isVariantParent);
  const copyGroup = isCopy && (product.isVariantParent || mode === "groupCopy") && group;
  if (groupEditing || copyGroup) {
    const sourceAttributes = group?.attributes ?? attributeSpecs.map(([name, values]) => ({
      name, values, createsVariants: true,
    }));
    let attributes = sourceAttributes;
    try { attributes = normalizeVariantAttributes(sourceAttributes); } catch { /* Keep incomplete axes visible for explicit correction. */ }
    const members = group?.members ?? [product];
    const selectedMembers = members.filter((member) => !member.isVariantParent);
    let combinations: ReturnType<typeof buildVariantCombinations> = [];
    try {
      combinations = buildVariantCombinations(attributes, isCopy ? undefined : {
        maxCombinations: variantCombinationBudget(selectedMembers.length, group?.excludedCombinationKeys?.length ?? 0),
      });
    } catch { /* Incomplete legacy groups require explicit assignments in the editor. */ }
    const possibleMatches = selectedMembers.map((member) => {
      const visibleSpecs = member.specs as Record<string, string[]> | null;
      return combinations.find((combo) => Object.entries(combo.specs).every(([name, values]) => JSON.stringify(visibleSpecs?.[name]) === JSON.stringify(values)));
    });
    const children: NonNullable<CreateProductInput["variantChildren"]> = selectedMembers.map((member, index) => {
      const visibleSpecs = Object.fromEntries(Object.entries((member.specs ?? {}) as Record<string, string[]>).filter(([name]) => !name.startsWith("__")));
      const candidate = possibleMatches[index];
      // Duplicated or missing selections require the user to assign the real SKU.
      const match = candidate && possibleMatches.filter((other) => other?.combinationKey === candidate.combinationKey).length === 1 ? candidate : undefined;
      return {
        ...(!isCopy ? { productId: member.id } : {}),
        combinationKey: match?.combinationKey,
        optionValueIds: match?.optionValueIds,
        variantName: match?.variantName ?? member.variantName ?? member.name,
        sku: isCopy ? "" : member.sku,
        barcode: isCopy ? "" : member.barcode ?? "",
        baseUnit: member.baseUnit,
        costPrice: Number(member.costPrice),
        retailPrice: Number(member.retailPrice),
        wholesalePrice: member.wholesalePrice == null ? null : Number(member.wholesalePrice),
        contractorPrice: member.contractorPrice == null ? null : Number(member.contractorPrice),
        agentPrice: member.agentPrice == null ? null : Number(member.agentPrice),
        initialStock: 0,
        currentStock: Number(member.totalStock ?? 0),
        directSale: member.isActive,
        specs: match?.specs ?? visibleSpecs,
        imageUrls: isCopy ? [] : member.imageUrls ?? [],
      };
    });
    return {
      ...shared,
      variantContractVersion: 2,
      variantOperation: isCopy ? "create" : mode === "groupAdd" || mode === "sameType" ? "add" : "edit",
      ...(!isCopy ? { variantGroupId: group?.id ?? product.id, variantRevision: group?.revision ?? 0 } : {}),
      attributes,
      variantChildren: children,
      excludedCombinationKeys: group?.excludedCombinationKeys ?? combinations.filter((combo) => !children.some((child) => child.combinationKey === combo.combinationKey)).map((combo) => combo.combinationKey),
      sku: isCopy ? "" : product.sku,
      barcode: isCopy ? "" : product.barcode ?? "",
      name: group?.name ?? product.name,
      imageUrls: isCopy ? [] : product.imageUrls ?? [],
      imageMediaIds: isCopy ? [] : imageMedia.map((image) => image.mediaId),
      location: product.location ?? "",
      description: product.description ?? "",
      invoiceNote: orderNote,
      directSale: product.isActive,
      initialStock: 0,
    };
  }

  return {
    ...shared,
    sku: isCopy ? "" : product.sku,
    barcode: isCopy ? "" : (product.barcode ?? ""),
    name: product.name,
    imageUrls: isCopy
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
