import type {
  KiotVietProduct,
  KiotVietProductSnapshot,
  KiotVietProductSyncPlan,
  KiotVietUnit,
  ProductArchiveAction,
} from "./product-sync";

const REQUIRED_APPLY_STORE = "hai-dang";

export function assertLegacyKiotVietImportReadOnly(dryRun: boolean): void {
  if (!dryRun) {
    throw new Error(
      "Legacy KiotViet writes are disabled. Run: bun sync:kiotviet-products <directory> --store=hai-dang, then add --apply only after reviewing the dry-run.",
    );
  }
}

export interface ProductSyncArgs {
  directory: string;
  storeSlug: string | null;
  apply: boolean;
}

export function parseProductSyncArgs(args: string[]): ProductSyncArgs {
  const apply = args.includes("--apply");
  const storeArg = args.find((arg) => arg.startsWith("--store="));
  const storeSlug = storeArg?.slice("--store=".length).trim() || null;
  const directory = args.find((arg) => !arg.startsWith("--")) ?? "kiotviet_data";
  if (apply && storeSlug !== REQUIRED_APPLY_STORE) {
    throw new Error(`--apply requires --store=${REQUIRED_APPLY_STORE}`);
  }
  return { directory, storeSlug, apply };
}

export interface ProductSyncSummary {
  sourceProducts: number;
  sourceUnits: number;
  creates: number;
  updates: number;
  archives: number;
  archiveReasons: {
    alternateUnitPlaceholder: number;
    historicalMissing: number;
    mappedMissing: number;
  };
  preserves: number;
  stockChanges: number;
  netStockDelta: number;
  inactiveSourceProducts: number;
  notDirectSaleProducts: number;
  mappingsAvailable: boolean;
  warnings: string[];
}

export function buildProductSyncSummary(input: {
  snapshot: KiotVietProductSnapshot;
  plan: KiotVietProductSyncPlan;
  mappingsAvailable: boolean;
}): ProductSyncSummary {
  const { snapshot, plan, mappingsAvailable } = input;
  const stockActions = [...plan.creates, ...plan.updates];
  const countArchiveReason = (reason: ProductArchiveAction["reason"]) =>
    plan.archives.filter((action) => action.reason === reason).length;
  return {
    sourceProducts: snapshot.products.length,
    sourceUnits: snapshot.units.length,
    creates: plan.creates.length,
    updates: plan.updates.length,
    archives: plan.archives.length,
    archiveReasons: {
      alternateUnitPlaceholder: countArchiveReason("alternate_unit_placeholder"),
      historicalMissing: countArchiveReason("historical_missing"),
      mappedMissing: countArchiveReason("mapped_missing"),
    },
    preserves: plan.preserves.length,
    stockChanges: stockActions.filter((action) => action.stockDelta !== 0).length,
    netStockDelta: Number(
      stockActions.reduce((sum, action) => sum + action.stockDelta, 0).toFixed(4),
    ),
    inactiveSourceProducts: snapshot.products.filter((product) => !product.isActive).length,
    notDirectSaleProducts: snapshot.products.filter((product) => !product.directSale).length,
    mappingsAvailable,
    warnings: mappingsAvailable
      ? []
      : [
        "Migration product_source_mappings is not installed; dry-run uses current SKU and KiotViet history evidence only.",
      ],
  };
}

export interface UpsertProductInput {
  productId?: string;
  source: KiotVietProduct;
}

export interface SetProductStockInput {
  productId: string;
  quantity: number;
  minLevel: number;
  unitCost: number;
  delta: number;
  isCreate: boolean;
}

export interface UpsertSourceMappingInput {
  productId: string;
  externalId: string;
  lastSeenAt: Date;
  deletedAt: Date | null;
}

export interface MarkSourceDeletedInput {
  productId: string;
  externalId: string;
  deletedAt: Date;
}

export interface ResolvedComboComponent {
  productId: string;
  quantity: number;
}

export interface ProductSyncTransaction {
  upsertProduct(input: UpsertProductInput): Promise<string>;
  replaceUnits(productId: string, units: KiotVietUnit[]): Promise<void>;
  setStock(input: SetProductStockInput): Promise<void>;
  upsertSourceMapping(input: UpsertSourceMappingInput): Promise<void>;
  markSourceDeleted(input: MarkSourceDeletedInput): Promise<void>;
  replaceComboItems(productId: string, components: ResolvedComboComponent[]): Promise<void>;
  setRelatedProduct(productId: string, relatedProductId: string | null): Promise<void>;
  archiveProduct(action: ProductArchiveAction): Promise<void>;
}

export async function applyKiotVietProductSync(input: {
  snapshot: KiotVietProductSnapshot;
  plan: KiotVietProductSyncPlan;
  seenAt: Date;
  runInTransaction: <T>(work: (transaction: ProductSyncTransaction) => Promise<T>) => Promise<T>;
}): Promise<void> {
  const { snapshot, plan, seenAt, runInTransaction } = input;
  await runInTransaction(async (transaction) => {
    const actions = [
      ...plan.creates.map((action) => ({ ...action, productId: undefined })),
      ...plan.updates,
    ];
    const productIdsBySku = new Map<string, string>();

    for (const action of actions) {
      const productId = await transaction.upsertProduct({
        productId: action.productId,
        source: action.source,
      });
      productIdsBySku.set(action.source.sku, productId);
    }

    const unitsByBaseSku = new Map<string, KiotVietUnit[]>();
    for (const unit of snapshot.units) {
      const units = unitsByBaseSku.get(unit.baseSku) ?? [];
      units.push(unit);
      unitsByBaseSku.set(unit.baseSku, units);
    }

    for (const action of actions) {
      const productId = productIdsBySku.get(action.source.sku);
      if (!productId) throw new Error(`Missing synchronized product id for ${action.source.sku}`);
      await transaction.setRelatedProduct(
        productId,
        action.source.relatedSku
          ? productIdsBySku.get(action.source.relatedSku) ?? null
          : null,
      );
    }

    for (const action of actions) {
      const productId = productIdsBySku.get(action.source.sku);
      if (!productId) throw new Error(`Missing synchronized product id for ${action.source.sku}`);
      await transaction.replaceUnits(productId, unitsByBaseSku.get(action.source.sku) ?? []);
      await transaction.setStock({
        productId,
        quantity: action.source.stock,
        minLevel: action.source.minLevel,
        unitCost: action.source.costPrice,
        delta: action.stockDelta,
        isCreate: action.productId == null,
      });
      await transaction.upsertSourceMapping({
        productId,
        externalId: action.source.sku,
        lastSeenAt: seenAt,
        deletedAt: null,
      });
    }

    for (const action of actions) {
      const productId = productIdsBySku.get(action.source.sku);
      if (!productId) throw new Error(`Missing synchronized product id for ${action.source.sku}`);
      const components = action.source.comboComponents.map((component) => {
        const componentProductId = productIdsBySku.get(component.sku);
        if (!componentProductId) {
          throw new Error(
            `Missing synchronized combo component id for ${action.source.sku}:${component.sku}`,
          );
        }
        return { productId: componentProductId, quantity: component.quantity };
      });
      await transaction.replaceComboItems(productId, components);
    }

    for (const action of plan.archives) {
      await transaction.archiveProduct(action);
      if (action.reason === "historical_missing") {
        await transaction.upsertSourceMapping({
          productId: action.productId,
          externalId: action.sourceExternalId ?? action.sku,
          lastSeenAt: seenAt,
          deletedAt: seenAt,
        });
      } else if (action.reason === "mapped_missing") {
        await transaction.markSourceDeleted({
          productId: action.productId,
          externalId: action.sku,
          deletedAt: seenAt,
        });
      }
    }
  });
}
