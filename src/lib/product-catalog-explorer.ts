import {
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogWarehouse,
} from "@/lib/product-catalog";
import type { ProductListResult } from "@/lib/data/products";
import type { PriceComparison } from "@/lib/pricing/price-comparison";

export type ProductExplorerFilters = PriceComparison & {
  query?: string;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  productKind?: ProductCatalogItem["productKind"];
  stock?: "instock" | "low" | "out";
  status?: "active" | "inactive" | "draft" | "archived" | "all";
  view?: "grouped" | "flat";
  sort?: "name" | "stock" | "updated";
  page?: number;
  pageSize?: number;
  cameraSkus?: ReadonlySet<string>;
  cameraMaterials?: boolean;
};

export type ProductExplorerResult = {
  rows: ProductListResult["rows"];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

type ProductRow = ProductListResult["rows"][number];
type CatalogGroup = {
  id: string;
  kind: "native" | "related";
  root: ProductCatalogItem;
  members: ProductCatalogItem[];
};

function productIsActive(product: ProductCatalogItem) {
  return product.isActive ?? product.lifecycleStatus === "active";
}

function stockQuantity(product: ProductCatalogItem) {
  return product.warehouseStock.reduce((sum, stock) => sum + Number(stock.quantity || 0), 0);
}

function effectiveSellingPrice(product: ProductCatalogItem, priceBookId?: string) {
  if (!priceBookId) return Number(product.retailPrice);
  const type = product.priceBookTypes?.[priceBookId];
  if (type === "cost") return Number(product.costPrice ?? 0);
  if (type === "purchase") {
    return product.lastPurchaseNetPrice == null ? null : Number(product.lastPurchaseNetPrice);
  }
  if (type === "retail") return Number(product.retailPrice);
  const override = product.prices[priceBookId];
  if (type === "list") return override == null ? null : Number(override);
  return override == null ? Number(product.retailPrice) : Number(override);
}

function matchesPrice(product: ProductCatalogItem, filters: ProductExplorerFilters) {
  if (!filters.priceCondition || !filters.priceAgainst) return true;
  const selling = effectiveSellingPrice(product, filters.priceBookId);
  const reference = filters.priceAgainst === "cost"
    ? (product.costPrice == null ? null : Number(product.costPrice))
    : (product.lastPurchaseNetPrice == null ? null : Number(product.lastPurchaseNetPrice));
  if (selling == null || reference == null || !Number.isFinite(selling) || !Number.isFinite(reference)) return false;
  switch (filters.priceCondition) {
    case "lt": return selling < reference;
    case "lte": return selling <= reference;
    case "eq": return selling === reference;
    case "gte": return selling >= reference;
    case "gt": return selling > reference;
  }
}

function matchesProduct(product: ProductCatalogItem, filters: ProductExplorerFilters) {
  const status = filters.status ?? "active";
  if (status === "active" && !productIsActive(product)) return false;
  if (status === "inactive" && productIsActive(product)) return false;
  if (status === "draft" && product.lifecycleStatus !== "draft") return false;
  if (status === "archived" && product.lifecycleStatus !== "archived") return false;
  if (filters.categoryId && product.categoryId !== filters.categoryId) return false;
  if (filters.brandId && product.brandId !== filters.brandId) return false;
  if (filters.supplierId && product.supplierId !== filters.supplierId && !product.supplierIDs?.includes(filters.supplierId)) return false;
  if (filters.productKind && product.productKind !== filters.productKind) return false;
  if (filters.cameraMaterials && !filters.cameraSkus?.has(product.sku) && (product.specs as Record<string, unknown> | null)?.__cameraQuoteMaterial !== true) return false;
  const quantity = stockQuantity(product);
  if (filters.stock === "instock" && quantity <= 0) return false;
  if (filters.stock === "out" && quantity > 0) return false;
  if (filters.stock === "low" && (quantity <= 0 || quantity > Number(product.minStock ?? 0))) return false;
  return matchesPrice(product, filters);
}

function groupKey(product: ProductCatalogItem): { id: string; kind: "native" | "related" } | null {
  if (product.isVariantParent) return { id: product.id, kind: "native" };
  if (product.variantGroupId) {
    return {
      id: product.variantGroupId,
      kind: product.variantGroupKind === "native" ? "native" : "related",
    };
  }
  if (product.parentProductId) return { id: product.parentProductId, kind: "native" };
  if (product.relatedProductId) return { id: product.relatedProductId, kind: "related" };
  return null;
}

function buildGroups(products: readonly ProductCatalogItem[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const groups = new Map<string, CatalogGroup>();
  for (const product of products) {
    const key = groupKey(product);
    if (!key) continue;
    const root = byId.get(key.id);
    if (!root) continue;
    const group = groups.get(key.id) ?? { id: key.id, kind: root.isVariantParent ? "native" : key.kind, root, members: [] };
    if (!product.isVariantParent && !group.members.some((member) => member.id === product.id)) group.members.push(product);
    groups.set(key.id, group);
  }
  for (const group of groups.values()) {
    if (group.kind === "related" && !group.members.some((member) => member.id === group.root.id)) {
      group.members.push(group.root);
    }
    group.members.sort((left, right) => left.sku.localeCompare(right.sku, "vi") || left.id.localeCompare(right.id));
  }
  return groups;
}

function makeProductRow(
  product: ProductCatalogItem,
  productsById: ReadonlyMap<string, ProductCatalogItem>,
  warehouses: ReadonlyMap<string, ProductCatalogWarehouse>,
): ProductRow {
  const warehouseStock = product.warehouseStock ?? [];
  const totalStock = stockQuantity(product);
  const minLevel = warehouseStock.reduce((value, stock) => Math.max(value, Number(stock.minLevel || 0)), 0);
  const comboItems = product.comboItems.map((item) => {
    const component = productsById.get(item.productId);
    return {
      productId: item.productId,
      name: component?.name ?? item.productId,
      sku: component?.sku ?? "",
      baseUnit: component?.baseUnit ?? "",
      quantity: item.quantity,
      productKind: component?.productKind === "service" ? "service" as const : "product" as const,
    };
  });
  const cost = product.costPrice ?? "0";
  const retail = product.retailPrice ?? "0";
  const row = {
    id: product.id,
    sku: product.sku,
    productKind: product.productKind,
    barcode: product.barcode,
    name: product.name,
    description: product.description ?? null,
    categoryId: product.categoryId,
    brandId: product.brandId,
    supplierId: product.supplierId ?? null,
    baseUnit: product.baseUnit,
    baseUnitDirectSale: product.baseUnitDirectSale,
    costPrice: cost,
    lastPurchasePrice: product.lastPurchasePrice ?? null,
    lastPurchaseNetPrice: product.lastPurchaseNetPrice ?? null,
    retailPrice: retail,
    wholesalePrice: product.wholesalePrice ?? null,
    contractorPrice: product.contractorPrice ?? null,
    agentPrice: product.agentPrice ?? null,
    vatRate: product.vatRate ?? null,
    priceByWeight: product.priceByWeight,
    trackBatches: product.trackBatches ?? false,
    shelfLifeDays: null,
    lifecycleStatus: product.lifecycleStatus ?? (productIsActive(product) ? "active" : "archived"),
    relatedProductId: product.relatedProductId ?? null,
    parentProductId: product.parentProductId,
    variantName: product.variantName,
    isVariantParent: product.isVariantParent,
    isActive: productIsActive(product),
    createdAt: new Date(product.createdAt ?? product.updatedAt),
    updatedAt: new Date(product.updatedAt),
    categoryName: product.categoryName,
    brandName: product.brandName,
    supplierName: product.supplierName ?? null,
    location: product.location ?? null,
    weight: product.weight ?? null,
    dimensions: product.dimensions ?? null,
    specs: product.specs,
    imageUrls: product.imageUrls ?? [],
    thumbnailImageUrl: product.imageUrls?.[0] ?? null,
    imageUpdatedAt: new Date(product.imageUpdatedAt),
    comboItems,
    childCount: 0,
    minCostPrice: cost,
    maxCostPrice: cost,
    minRetailPrice: retail,
    maxRetailPrice: retail,
    totalStock: String(totalStock),
    reservedStock: String(warehouseStock.reduce((sum, stock) => sum + Number(stock.reserved || 0), 0)),
    minLevel: String(minLevel),
    unitNames: product.units.map((unit) => unit.unitName).join(", ") || null,
    unitDefinitions: product.units,
    children: [] as ProductRow["children"],
    stockLocations: warehouseStock.map((stock) => ({
      warehouseId: stock.warehouseId,
      warehouseName: warehouses.get(stock.warehouseId)?.name ?? "",
      quantity: Number(stock.quantity),
      reserved: Number(stock.reserved),
      minLevel: Number(stock.minLevel),
    })),
    stockMovements: [] as ProductRow["stockMovements"],
    relatedProducts: [] as ProductRow["relatedProducts"],
    m2PerUnit: product.m2PerUnit ?? null,
    model: product.model ?? null,
    minStock: product.minStock ?? "0",
    isStockManaged: product.isStockManaged,
  };
  return row as unknown as ProductRow;
}

function compareNumbers(left: string, right: string, descending: boolean) {
  const a = Number(left);
  const b = Number(right);
  const aInvalid = !Number.isFinite(a);
  const bInvalid = !Number.isFinite(b);
  if (aInvalid || bInvalid) return Number(aInvalid) - Number(bInvalid);
  return (descending ? b - a : a - b);
}

export function exploreProductCatalog(
  products: readonly ProductCatalogItem[],
  warehouseRows: readonly ProductCatalogWarehouse[],
  filters: ProductExplorerFilters = {},
): ProductExplorerResult {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, filters.pageSize ?? 20);
  const view = filters.view ?? "grouped";
  const byId = new Map(products.map((product) => [product.id, product]));
  const warehouseById = new Map(warehouseRows.map((warehouse) => [warehouse.id, warehouse]));
  const groups = buildGroups(products);
  const q = filters.query?.trim() ?? "";
  const searchable = products.filter((product) => !product.isVariantParent);
  const searchRows = q ? searchProductCatalog(searchable, q, { limit: searchable.length }) : searchable;
  const searchRank = new Map(searchRows.map((product, index) => [product.id, index]));
  const matched = new Set(searchRows.filter((product) => matchesProduct(product, filters)).map((product) => product.id));

  const candidates: Array<{ product: ProductCatalogItem; rank: number }> = [];
  if (view === "flat") {
    for (const product of searchable) {
      if (matched.has(product.id)) candidates.push({ product, rank: searchRank.get(product.id) ?? Number.MAX_SAFE_INTEGER });
    }
  } else {
    const groupedMemberIds = new Set<string>();
    for (const group of groups.values()) {
      const members = group.members.length ? group.members : [group.root];
      for (const member of members) groupedMemberIds.add(member.id);
      const matchingMembers = members.filter((member) => matched.has(member.id));
      if (matchingMembers.length === 0) continue;
      candidates.push({
        product: group.root,
        rank: Math.min(...matchingMembers.map((member) => searchRank.get(member.id) ?? Number.MAX_SAFE_INTEGER)),
      });
    }
    for (const product of searchable) {
      if (!groupedMemberIds.has(product.id) && matched.has(product.id)) {
        candidates.push({ product, rank: searchRank.get(product.id) ?? Number.MAX_SAFE_INTEGER });
      }
    }
  }

  if (q) {
    candidates.sort((left, right) => left.rank - right.rank || left.product.id.localeCompare(right.product.id));
  } else if (filters.sort === "stock") {
    candidates.sort((left, right) => compareNumbers(String(stockQuantity(left.product)), String(stockQuantity(right.product)), true)
      || left.product.name.localeCompare(right.product.name, "vi") || left.product.id.localeCompare(right.product.id));
  } else if (filters.sort === "updated") {
    candidates.sort((left, right) => right.product.updatedAt.localeCompare(left.product.updatedAt)
      || left.product.name.localeCompare(right.product.name, "vi") || left.product.id.localeCompare(right.product.id));
  } else {
    candidates.sort((left, right) => left.product.name.localeCompare(right.product.name, "vi") || left.product.id.localeCompare(right.product.id));
  }

  const total = candidates.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = candidates.slice((page - 1) * pageSize, page * pageSize).map(({ product }) => {
    const row = makeProductRow(product, byId, warehouseById);
    const key = groupKey(product);
    const group = key ? groups.get(key.id) : groups.get(product.id);
    if (!group) return row;
    const members = group.members.map((member) => makeProductRow(member, byId, warehouseById));
    const units = new Set(members.map((member) => member.baseUnit.trim().toLocaleLowerCase("vi")));
    const costs = members.map((member) => Number(member.costPrice));
    const retailPrices = members.map((member) => Number(member.retailPrice));
    const totalStock = units.size <= 1 ? String(members.reduce((sum, member) => sum + Number(member.totalStock), 0)) : null;
    const projectedGroup = {
      id: group.id,
      name: group.root.name,
      kind: group.kind,
      attributes: [],
      members,
      excludedCombinationKeys: [],
      revision: 0,
      requiresReview: false,
      count: members.length,
      totalStock,
      minCostPrice: String(Math.min(...costs)),
      maxCostPrice: String(Math.max(...costs)),
      minRetailPrice: String(Math.min(...retailPrices)),
      maxRetailPrice: String(Math.max(...retailPrices)),
    };
    row.variantGroup = projectedGroup as ProductRow["variantGroup"];
    if (group.kind === "native") {
      row.children = members as unknown as ProductRow["children"];
      row.childCount = members.length;
      if (members.length) {
        row.minCostPrice = String(Math.min(...costs));
        row.maxCostPrice = String(Math.max(...costs));
        row.minRetailPrice = String(Math.min(...retailPrices));
        row.maxRetailPrice = String(Math.max(...retailPrices));
      }
    } else {
      row.relatedProducts = members as unknown as ProductRow["relatedProducts"];
    }
    return row;
  });
  return { rows: pageRows, total, page, pageSize, pageCount };
}

export function visibleProductIds(rows: ProductListResult["rows"], grouped: boolean) {
  return [...new Set(rows.flatMap((row) => grouped && row.variantGroup
    ? row.variantGroup.members.filter((member) => !member.isVariantParent).map((member) => member.id)
    : row.isVariantParent ? [] : [row.id]))];
}

export function productCatalogMatches(
  products: readonly ProductCatalogItem[],
  warehouseRows: readonly ProductCatalogWarehouse[],
  filters: ProductExplorerFilters,
) {
  return exploreProductCatalog(products, warehouseRows, { ...filters, page: 1, pageSize: 1 }).total;
}
