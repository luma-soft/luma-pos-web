/**
 * Synchronize the KiotViet product master into one LumaPOS store.
 *
 * Dry-run is the default:
 *   bun sync:kiotviet-products [directory] --store=hai-dang
 *
 * Applying requires the exact target store and the ownership migration:
 *   bun sync:kiotviet-products [directory] --store=hai-dang --apply
 */
import { randomUUID } from "node:crypto";
import { parseKiotVietProductRows, planKiotVietProductSync } from "../lib/kiotviet/product-sync";
import { createKiotVietProductSyncTransaction } from "../lib/kiotviet/product-sync-database";
import {
  readKiotVietProductHistory,
  readNewestKiotVietSheet,
} from "../lib/kiotviet/product-sync-files";
import {
  applyKiotVietProductSync,
  buildProductSyncSummary,
  parseProductSyncArgs,
} from "../lib/kiotviet/product-sync-runner";

const DEFAULT_DRY_RUN_STORE = "hai-dang";
const PROVIDER = "kiotviet";

function hasDatabaseErrorCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && current.code === expectedCode) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function main(): Promise<void> {
  const args = parseProductSyncArgs(process.argv.slice(2));
  const storeSlug = args.storeSlug ?? DEFAULT_DRY_RUN_STORE;
  const source = readNewestKiotVietSheet({
    directory: args.directory,
    prefix: "DanhSachSanPham",
    required: true,
  });
  if (!source) throw new Error("KiotViet product workbook is required");
  const snapshot = parseKiotVietProductRows(source.rows);
  const history = readKiotVietProductHistory(args.directory);

  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { and, eq } = await import("drizzle-orm");

  const matchingStores = await db
    .select({ id: schema.stores.id, slug: schema.stores.slug })
    .from(schema.stores)
    .where(eq(schema.stores.slug, storeSlug))
    .limit(2);
  if (matchingStores.length !== 1) {
    throw new Error(`Expected exactly one LumaPOS store with slug ${storeSlug}`);
  }
  const store = matchingStores[0];
  const currentRows = await db
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      stock: schema.products.totalStock,
      isActive: schema.products.isActive,
    })
    .from(schema.products)
    .where(eq(schema.products.storeId, store.id));
  const currentProducts = currentRows.map((product) => ({
    id: product.id,
    sku: product.sku,
    stock: Number(product.stock),
    isActive: product.isActive,
  }));

  let mappingsAvailable = true;
  let sourceMappings: Array<{ productId: string; externalId: string; deletedAt: Date | null }> = [];
  try {
    sourceMappings = await db
      .select({
        productId: schema.productSourceMappings.productId,
        externalId: schema.productSourceMappings.externalId,
        deletedAt: schema.productSourceMappings.deletedAt,
      })
      .from(schema.productSourceMappings)
      .where(and(
        eq(schema.productSourceMappings.storeId, store.id),
        eq(schema.productSourceMappings.provider, PROVIDER),
      ));
  } catch (error) {
    if (!hasDatabaseErrorCode(error, "42P01")) throw error;
    mappingsAvailable = false;
  }

  const plan = planKiotVietProductSync({
    snapshot,
    currentProducts,
    sourceMappings,
    historicalSkus: history.skus,
  });
  const summary = buildProductSyncSummary({ snapshot, plan, mappingsAvailable });
  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    store: { id: store.id, slug: store.slug },
    sourceFile: source.filename,
    historyFiles: history.filenames,
    summary,
  }, null, 2));

  if (!args.apply) {
    console.log("\nDry-run complete: no database writes were performed.");
    return;
  }
  if (!mappingsAvailable) {
    throw new Error(
      "Cannot apply before drizzle/0114_kiotviet_product_sync.sql is installed.",
    );
  }
  const warehouses = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(and(
      eq(schema.warehouses.storeId, store.id),
      eq(schema.warehouses.isDefault, true),
    ))
    .limit(2);
  if (warehouses.length !== 1) {
    throw new Error(`Expected exactly one default warehouse for store ${store.slug}`);
  }

  const seenAt = new Date();
  const runId = randomUUID();
  await applyKiotVietProductSync({
    snapshot,
    plan,
    seenAt,
    runInTransaction: (work) => db.transaction((transaction) => work(
      createKiotVietProductSyncTransaction({
        transaction,
        storeId: store.id,
        warehouseId: warehouses[0].id,
        runId,
      }),
    )),
  });
  console.log(`\nApplied KiotViet product sync transaction ${runId}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
