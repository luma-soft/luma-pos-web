import type { ProductDetail } from "@/lib/data/products";
import type { CreateProductInput } from "./new/schema";
import { buildVariantCombinations, normalizeVariantAttributes, variantCombinationBudget, variantNameKey } from "@/lib/products/variant-model";

export type ProductSeedMode = "edit" | "copy" | "groupCopy" | "sameType" | "groupEdit" | "groupAdd";
const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

function variantBaseName(name: string, variantName: string | null | undefined) {
  const normalizedName = name.trim();
  const suffix = variantName?.trim() ? ` - ${variantName.trim()}` : "";
  return suffix && normalizedName.endsWith(suffix)
    ? normalizedName.slice(0, -suffix.length).trim()
    : normalizedName;
}

export function latestVariantMemberId(product: ProductDetail): string | undefined {
  return product.variantGroup?.members
    .filter((member) => !member.isVariantParent)
    .slice()
    .sort((left, right) => {
      const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return byTime || right.id.localeCompare(left.id);
    })[0]?.id;
}

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
): Partial<CreateProductInput> {
  const isCopy = mode === "copy" || mode === "groupCopy";
  const clearsIdentity = isCopy || mode === "groupAdd" || mode === "sameType";
  const specs = (product.specs as Record<string, string[]> | null) ?? {};
  const orderNote = specs[PRODUCT_ORDER_NOTE_SPEC_KEY]?.[0] ?? "";
  const attributeSpecs = Object.entries(specs).filter(
    ([name]) => !name.startsWith("__"),
  );
  const imageMedia = product.imageMedia ?? [];
  const imageSourceProductIds = isCopy
    ? [product.id, product.parentProductId, product.relatedProductId].filter(
        (id): id is string => Boolean(id),
      )
    : [];
  const shared: Partial<CreateProductInput> = {
    productKind: product.productKind,
    categoryId: product.categoryId ?? "",
    brandId: product.brandId ?? "",
    supplierIds: product.suppliers.map((s) => s.id),
    baseUnit: product.baseUnit,
    baseUnitDirectSale: product.baseUnitDirectSale,
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
      barcode: clearsIdentity ? "" : (u.barcode ?? ""),
      priceOverride: u.priceOverride != null ? Number(u.priceOverride) : null,
      directSale: u.directSale,
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
    const combinationByKey = new Map(combinations.map((combination) => [combination.combinationKey, combination]));
    const possibleMatches = selectedMembers.map((member) => {
      // The group projection already resolves aliases and stable value IDs.
      // Prefer that identity over exact display-name lookups in legacy specs.
      const identityMatch = member.combinationKey ? combinationByKey.get(member.combinationKey) : undefined;
      if (identityMatch) return identityMatch;

      const visibleSpecs = Object.fromEntries(Object.entries((member.specs ?? {}) as Record<string, string[]>)
        .filter(([name]) => !name.startsWith("__")));
      const entries = Object.entries(visibleSpecs);
      return combinations.find((combo) => {
        const axes = Object.entries(combo.specs);
        return axes.every(([name, values]) => {
          const matches = entries.filter(([entryName]) => variantNameKey(entryName) === variantNameKey(name));
          const actual = matches[0]?.[1];
          return matches.length === 1 && actual?.length === 1
            && variantNameKey(actual[0]) === variantNameKey(values[0]);
        });
      });
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
    const variantAddition = mode === "groupAdd" || mode === "sameType";
    // Keep existing SKU identities in the add payload, including imported groups
    // whose persisted membership keys still need repair. The writer must not
    // modify those SKUs' commercial data during an add operation.
    const templateVariantName = product.variantName
      ?? children.find((child) => child.productId === product.id)?.variantName;
    return {
      ...shared,
      // A standalone legacy SKU has no persisted group attribute IDs yet. Let
      // the writer resolve those axes through the attribute catalog by name.
      variantContractVersion: !group && variantAddition ? undefined : 2,
      variantOperation: isCopy ? "create" : variantAddition ? "add" : "edit",
      ...(!isCopy ? { variantGroupId: group?.id ?? product.id, variantRevision: group?.revision ?? 0 } : {}),
      attributes,
      // Adding to a persisted group is an additive operation: the writer
      // resolves all existing members from locked DB rows, not the form draft.
      // Standalone SKUs still include their original row for first adoption.
      variantChildren: variantAddition && group ? [] : children,
      excludedCombinationKeys: group?.excludedCombinationKeys ?? combinations.filter((combo) => !children.some((child) => child.combinationKey === combo.combinationKey)).map((combo) => combo.combinationKey),
      sku: clearsIdentity ? "" : product.sku,
      barcode: clearsIdentity ? "" : product.barcode ?? "",
      name: variantAddition ? variantBaseName(product.name, templateVariantName) : group?.name ?? product.name,
      imageUrls: product.imageUrls ?? [],
      imageMediaIds: imageMedia.map((image) => image.mediaId),
      imageSourceProductIds,
      ...(variantAddition ? {
        variantTemplateProductId: latestVariantMemberId(product) ?? (!group ? product.id : undefined),
        imageSourceProductIds: [...new Set([...imageSourceProductIds, product.id])],
        variantAddValues: Object.fromEntries(attributes.map((attribute) => ["attributeId" in attribute ? attribute.attributeId : "", ""])),
        variantExistingCombinationKeys: selectedMembers.flatMap((member, index) => {
          const key = member.combinationKey && combinationByKey.has(member.combinationKey)
            ? member.combinationKey
            : children[index]?.combinationKey;
          return key ? [key] : [];
        }),
      } : {}),
      location: product.location ?? "",
      description: product.description ?? "",
      invoiceNote: orderNote,
      directSale: product.isActive,
      initialStock: 0,
    };
  }

  let editableAttributes = shared.attributes;
  if (mode === "edit" && group && product.combinationKey) {
    try {
      const selections = new Map(JSON.parse(product.combinationKey) as [string, string][]);
      const groupNames = new Set(group.attributes.map((attribute) => attribute.name.trim().toLocaleLowerCase()));
      const identityAttributes = group.attributes.map((attribute) => {
        const optionValueId = selections.get(attribute.attributeId) ?? "";
        const valueIndex = attribute.valueIds.indexOf(optionValueId);
        if (valueIndex < 0) throw new Error("Invalid variant identity");
        return {
          attributeId: attribute.attributeId,
          name: attribute.name,
          values: [attribute.values[valueIndex]],
          valueIds: [optionValueId],
          createsVariants: false,
        };
      });
      editableAttributes = [
        ...identityAttributes,
        ...(shared.attributes ?? []).filter((attribute) => !groupNames.has(attribute.name.trim().toLocaleLowerCase())),
      ];
    } catch {
      // Legacy/incomplete identities stay visible but locked by the form.
    }
  }

  return {
    ...shared,
    attributes: editableAttributes,
    sku: isCopy ? "" : product.sku,
    barcode: isCopy ? "" : (product.barcode ?? ""),
    name: product.name,
    imageUrls: product.imageUrls ?? [],
    imageMediaIds: imageMedia.map((image) => image.mediaId),
    imageSourceProductIds,
    location: product.location ?? "",
    description: product.description ?? "",
    invoiceNote: orderNote,
    directSale: product.isActive,
    initialStock: 0,
    ...(mode === "edit" ? { currentStock: Number(product.totalStock ?? 0) } : {}),
  };
}
