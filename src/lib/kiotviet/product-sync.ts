export type KiotVietProductKind = "product" | "service" | "combo";

export interface KiotVietComboComponent {
  sku: string;
  quantity: number;
}

export interface KiotVietProduct {
  sku: string;
  barcode: string;
  name: string;
  productKind: KiotVietProductKind;
  categoryPath: string[];
  brand: string;
  baseUnit: string;
  costPrice: number;
  retailPrice: number;
  vatRate: number | null;
  stock: number;
  minLevel: number;
  location: string;
  description: string;
  weight: number | null;
  imageUrls: string[];
  isActive: boolean;
  directSale: boolean;
  specs: Record<string, string[]> | null;
  comboComponents: KiotVietComboComponent[];
}

export interface KiotVietUnit {
  sku: string;
  baseSku: string;
  unitName: string;
  multiplier: number;
  barcode: string;
  priceOverride: number | null;
  sourceStock: number;
}

export interface KiotVietProductSnapshot {
  products: KiotVietProduct[];
  units: KiotVietUnit[];
}

export interface LumaProductSnapshot {
  id: string;
  sku: string;
  stock: number;
  isActive: boolean;
}

export interface ProductSourceMappingSnapshot {
  productId: string;
  externalId: string;
  deletedAt: Date | string | null;
}

export type ProductArchiveReason =
  | "alternate_unit_placeholder"
  | "historical_missing"
  | "mapped_missing";

export interface ProductCreateAction {
  source: KiotVietProduct;
  stockDelta: number;
}

export interface ProductUpdateAction {
  productId: string;
  source: KiotVietProduct;
  stockDelta: number;
}

export interface ProductArchiveAction {
  productId: string;
  sku: string;
  reason: ProductArchiveReason;
}

export interface ProductPreserveAction {
  productId: string;
  sku: string;
}

export interface KiotVietProductSyncPlan {
  creates: ProductCreateAction[];
  updates: ProductUpdateAction[];
  archives: ProductArchiveAction[];
  preserves: ProductPreserveAction[];
}

export interface PlanKiotVietProductSyncInput {
  snapshot: KiotVietProductSnapshot;
  currentProducts: LumaProductSnapshot[];
  sourceMappings: ProductSourceMappingSnapshot[];
  historicalSkus: ReadonlySet<string>;
}

type SourceRow = Record<string, unknown>;

const text = (value: unknown): string => value == null ? "" : String(value).trim();

const number = (value: unknown): number => {
  if (value == null || value === "" || value === "--") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "" || value === "--") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAttributes(value: unknown): {
  specs: Record<string, string[]> | null;
  suffix: string;
} {
  const specs: Record<string, string[]> = {};
  const suffixValues: string[] = [];
  for (const rawPart of text(value).split("|")) {
    const separator = rawPart.indexOf(":");
    if (separator < 0) continue;
    const name = rawPart.slice(0, separator).trim();
    const attributeValue = rawPart.slice(separator + 1).trim();
    if (!name || !attributeValue) continue;
    specs[name] = [attributeValue];
    suffixValues.push(attributeValue);
  }
  return {
    specs: suffixValues.length > 0 ? specs : null,
    suffix: suffixValues.length > 0 ? ` - ${suffixValues.join(" - ")}` : "",
  };
}

function parseProductKind(value: unknown): KiotVietProductKind {
  const kind = text(value).toLocaleLowerCase("vi");
  if (kind === "dịch vụ") return "service";
  if (kind.startsWith("combo")) return "combo";
  return "product";
}

function parseImages(value: unknown): string[] {
  return text(value)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function parseComboComponents(value: unknown): KiotVietComboComponent[] {
  return text(value)
    .split("|")
    .map((part) => {
      const separator = part.lastIndexOf(":");
      if (separator < 0) return null;
      const sku = part.slice(0, separator).trim();
      const quantity = number(part.slice(separator + 1));
      return sku && quantity > 0 ? { sku, quantity } : null;
    })
    .filter((component): component is KiotVietComboComponent => component != null);
}

export function parseKiotVietProductRows(rows: SourceRow[]): KiotVietProductSnapshot {
  const products: KiotVietProduct[] = [];
  const units: KiotVietUnit[] = [];

  for (const row of rows) {
    const sku = text(row["Mã hàng"]);
    if (!sku) continue;
    const baseSku = text(row["Mã ĐVT Cơ bản"]);

    if (baseSku) {
      units.push({
        sku,
        baseSku,
        unitName: text(row["ĐVT"]) || "đv",
        multiplier: number(row["Quy đổi"]) || 1,
        barcode: text(row["Mã vạch"]),
        priceOverride: nullableNumber(row["Giá bán"]),
        sourceStock: number(row["Tồn kho"]),
      });
      continue;
    }

    const { specs, suffix } = parseAttributes(row["Thuộc tính"]);
    const productKind = parseProductKind(row["Loại hàng"]);
    const baseUnit = text(row["ĐVT"])
      || (productKind === "combo" ? "combo" : "cái");
    products.push({
      sku,
      barcode: text(row["Mã vạch"]),
      name: `${text(row["Tên hàng"]) || sku}${suffix}`,
      productKind,
      categoryPath: text(row["Nhóm hàng(3 Cấp)"])
        .split(">>")
        .map((part) => part.trim())
        .filter(Boolean),
      brand: text(row["Thương hiệu"]),
      baseUnit,
      costPrice: number(row["Giá vốn"]),
      retailPrice: number(row["Giá bán"]),
      vatRate: nullableNumber(row["Tỷ lệ tính thuế(%)"]),
      stock: number(row["Tồn kho"]),
      minLevel: number(row["Tồn nhỏ nhất"]),
      location: text(row["Vị trí"]),
      description: text(row["Mô tả"]),
      weight: nullableNumber(row["Trọng lượng"]),
      imageUrls: parseImages(row["Hình ảnh (url1,url2...)"]),
      isActive: text(row["Đang kinh doanh"]) !== "0",
      directSale: text(row["Được bán trực tiếp"]) !== "0",
      specs,
      comboComponents: parseComboComponents(row["Hàng thành phần"]),
    });
  }

  return { products, units };
}

function assertUniqueSkus(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate KiotViet ${label} SKU: ${value}`);
    seen.add(value);
  }
}

export function planKiotVietProductSync(
  input: PlanKiotVietProductSyncInput,
): KiotVietProductSyncPlan {
  const { snapshot, currentProducts, sourceMappings, historicalSkus } = input;
  assertUniqueSkus(snapshot.products.map((product) => product.sku), "product");
  assertUniqueSkus(snapshot.units.map((unit) => unit.sku), "unit");

  const sourceBySku = new Map(snapshot.products.map((product) => [product.sku, product]));
  for (const unit of snapshot.units) {
    if (sourceBySku.has(unit.sku)) {
      throw new Error(`KiotViet SKU is both a product and a unit: ${unit.sku}`);
    }
    if (!sourceBySku.has(unit.baseSku)) {
      throw new Error(`Orphan KiotViet unit SKU ${unit.sku}: base ${unit.baseSku} not found`);
    }
  }
  for (const product of snapshot.products) {
    for (const component of product.comboComponents) {
      if (!sourceBySku.has(component.sku)) {
        throw new Error(
          `KiotViet combo ${product.sku} references missing component ${component.sku}`,
        );
      }
    }
  }

  const currentBySku = new Map(currentProducts.map((product) => [product.sku, product]));
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));
  const mappingByExternalId = new Map(
    sourceMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const mappedProductIds = new Set(sourceMappings.map((mapping) => mapping.productId));
  const alternateUnitSkus = new Set(snapshot.units.map((unit) => unit.sku));
  const updatedProductIds = new Set<string>();
  const creates: ProductCreateAction[] = [];
  const updates: ProductUpdateAction[] = [];
  const archives: ProductArchiveAction[] = [];
  const preserves: ProductPreserveAction[] = [];

  for (const source of snapshot.products) {
    const skuMatch = currentBySku.get(source.sku);
    const mappedMatch = currentById.get(mappingByExternalId.get(source.sku)?.productId ?? "");
    if (skuMatch && mappedMatch && skuMatch.id !== mappedMatch.id) {
      throw new Error(
        `KiotViet source mapping conflict for ${source.sku}: mapped product ${mappedMatch.id} differs from SKU product ${skuMatch.id}`,
      );
    }
    const current = skuMatch ?? mappedMatch;
    if (current) {
      updatedProductIds.add(current.id);
      updates.push({
        productId: current.id,
        source,
        stockDelta: source.stock - current.stock,
      });
    } else {
      creates.push({ source, stockDelta: source.stock });
    }
  }

  for (const current of currentProducts) {
    if (sourceBySku.has(current.sku) || updatedProductIds.has(current.id)) continue;
    let reason: ProductArchiveReason | null = null;
    if (alternateUnitSkus.has(current.sku)) {
      reason = "alternate_unit_placeholder";
    } else if (mappedProductIds.has(current.id)) {
      reason = "mapped_missing";
    } else if (historicalSkus.has(current.sku)) {
      reason = "historical_missing";
    }

    if (reason) {
      archives.push({ productId: current.id, sku: current.sku, reason });
    } else {
      preserves.push({ productId: current.id, sku: current.sku });
    }
  }

  creates.sort((a, b) => a.source.sku.localeCompare(b.source.sku));
  updates.sort((a, b) => a.source.sku.localeCompare(b.source.sku));
  archives.sort((a, b) => a.sku.localeCompare(b.sku));
  preserves.sort((a, b) => a.sku.localeCompare(b.sku));

  return { creates, updates, archives, preserves };
}
