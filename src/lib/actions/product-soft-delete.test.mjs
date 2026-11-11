import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("deleting a product retains its database identity and historical relations", () => {
  const actions = source("./products.ts");
  const deleteBody = actions.split("async function deleteProductRecord(")[1]
    ?.split("export async function deleteProduct(")[0] ?? "";
  expect(deleteBody).toContain('lifecycleStatus: "deleted"');
  expect(deleteBody).toContain("isActive: false");
  expect(deleteBody).toContain("stockLevels.reserved");
  expect(deleteBody).toContain("stockLevels.quantity");
  expect(deleteBody).toContain("catalogSyncState.id");
  expect(deleteBody).toContain('action: "product.deleted"');
  expect(deleteBody).not.toContain("tx.delete(products)");

  const bulk = actions.split("export async function bulkDeleteProducts(")[1]
    ?.split("export async function setCameraMaterial(")[0] ?? "";
  expect(bulk).toContain("deleteProductRecord(id, true)");
  expect(bulk).not.toContain("tx.delete(products)");
  expect(actions).toContain('ne(products.lifecycleStatus, "deleted")');
});

test("deleted SKUs leave active and offline catalogs but keep their IDs in documents", () => {
  const catalog = source("../data/product-catalog.ts");
  const products = source("../data/products.ts");
  expect(catalog).toContain('ne(products.lifecycleStatus, "deleted")');
  expect(catalog).toContain("deletedIds: batch.productIds.filter((id) => !liveIds.has(id))");
  expect(products).toContain('lifecycle_status")} <> \'deleted\'');

  for (const path of [
    "../data/orders.ts",
    "../data/inventory.ts",
    "../data/returns.ts",
    "../data/purchase-returns.ts",
    "../../app/api/mobile/stocktakes/[id]/route.ts",
  ]) {
    expect(source(path)).toContain("{DEL}");
  }
});

test("new purchase lines store product snapshots and return stock cannot revive deleted SKUs", () => {
  const purchases = source("./purchases.ts");
  expect(purchases.match(/productName: snapshotsById.get\(i.productId\)!\.name/g)).toHaveLength(2);
  expect(purchases).toContain("productName: snapshotsById.get(item.productId)!.name");
  expect(purchases).toContain('product.lifecycleStatus === "deleted"');

  const returns = source("./returns.ts");
  expect(returns).toContain("assertRestockTargetsNotDeleted");
  expect(returns).toContain('DELETED_PRODUCT_CANNOT_RESTOCK: "returns.errors.deletedProductRestock"');
});
