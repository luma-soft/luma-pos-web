import {
  isProductCatalogCacheSchemaCompatible,
  catalogRevisionChanged,
  type ProductCatalogItem,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";

const DB_NAME = "luma-pos-shared";
const DB_VERSION = 2;
const LEGACY_STORE = "product-catalog";
const META_STORE = "product-catalog-meta";
const PRODUCTS_STORE = "product-catalog-products";

export type ProductCatalogWriteChanges = {
  changedProductIDs: readonly string[];
  deletedProductIDs: readonly string[];
};

function productKey(scopeId: string, productId: string) {
  return `${scopeId}::${productId}`;
}

function productRange(scopeId: string) {
  const prefix = `${scopeId}::`;
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function headerOnly(snapshot: ProductCatalogSnapshot): ProductCatalogSnapshot {
  return { ...snapshot, products: [] };
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) return;
      const legacy = database.objectStoreNames.contains(LEGACY_STORE)
        ? transaction.objectStore(LEGACY_STORE)
        : null;
      const meta = database.objectStoreNames.contains(META_STORE)
        ? transaction.objectStore(META_STORE)
        : database.createObjectStore(META_STORE);
      const products = database.objectStoreNames.contains(PRODUCTS_STORE)
        ? transaction.objectStore(PRODUCTS_STORE)
        : database.createObjectStore(PRODUCTS_STORE);
      if (!legacy) return;

      const cursorRequest = legacy.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const snapshot = cursor.value as ProductCatalogSnapshot | undefined;
        if (snapshot?.scopeId && Array.isArray(snapshot.products)) {
          meta.put(headerOnly(snapshot), snapshot.scopeId);
          for (const product of snapshot.products) {
            products.put(product, productKey(snapshot.scopeId, product.id));
          }
        }
        cursor.delete();
        cursor.continue();
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readProductCatalogSnapshot(
  scopeId: string,
): Promise<ProductCatalogSnapshot | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction([META_STORE, PRODUCTS_STORE], "readonly");
    const metaRequest = transaction.objectStore(META_STORE).get(scopeId);
    const rowsRequest = transaction.objectStore(PRODUCTS_STORE).openCursor(productRange(scopeId));
    let header: ProductCatalogSnapshot | null = null;
    const products: ProductCatalogItem[] = [];
    metaRequest.onsuccess = () => {
      header = (metaRequest.result as ProductCatalogSnapshot | undefined) ?? null;
    };
    rowsRequest.onsuccess = () => {
      const cursor = rowsRequest.result;
      if (!cursor) return;
      products.push(cursor.value as ProductCatalogItem);
      cursor.continue();
    };
    transaction.oncomplete = () => {
      database.close();
      if (
        !header || header.scopeId !== scopeId ||
        !isProductCatalogCacheSchemaCompatible(header.schemaVersion)
      ) {
        resolve(null);
        return;
      }
      resolve({ ...header, products });
    };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

export async function writeProductCatalogSnapshot(
  snapshot: ProductCatalogSnapshot,
  changes?: ProductCatalogWriteChanges,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction([META_STORE, PRODUCTS_STORE], "readwrite");
    const metaStore = transaction.objectStore(META_STORE);
    const productsStore = transaction.objectStore(PRODUCTS_STORE);
    const currentRequest = metaStore.get(snapshot.scopeId);
    currentRequest.onsuccess = () => {
      const current = currentRequest.result as ProductCatalogSnapshot | undefined;
      if (
        current?.schemaVersion === snapshot.schemaVersion &&
        catalogRevisionChanged(snapshot.revision, current.revision)
      ) return;

      const saveRows = () => {
        if (!changes) {
          for (const product of snapshot.products) {
            productsStore.put(product, productKey(snapshot.scopeId, product.id));
          }
        } else {
          for (const id of changes.deletedProductIDs) {
            productsStore.delete(productKey(snapshot.scopeId, id));
          }
          const byID = new Map(snapshot.products.map((product) => [product.id, product]));
          for (const id of changes.changedProductIDs) {
            const product = byID.get(id);
            if (product) productsStore.put(product, productKey(snapshot.scopeId, id));
          }
        }
        metaStore.put(headerOnly(snapshot), snapshot.scopeId);
      };

      if (!changes) {
        const cursorRequest = productsStore.openCursor(productRange(snapshot.scopeId));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }
          saveRows();
        };
      } else {
        saveRows();
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

export async function clearProductCatalogSnapshot(scopeId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction([META_STORE, PRODUCTS_STORE], "readwrite");
    transaction.objectStore(META_STORE).delete(scopeId);
    const cursorRequest = transaction.objectStore(PRODUCTS_STORE).openCursor(productRange(scopeId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(); };
  });
}

export async function clearProductCatalogSnapshotsForUser(userId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction([META_STORE, PRODUCTS_STORE], "readwrite");
    const metaStore = transaction.objectStore(META_STORE);
    const productsStore = transaction.objectStore(PRODUCTS_STORE);
    const cursorRequest = metaStore.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const key = String(cursor.key);
      const segments = key.split(":");
      if (segments[1] === userId || segments[0] === userId) {
        cursor.delete();
        const productCursor = productsStore.openCursor(productRange(key));
        productCursor.onsuccess = () => {
          const product = productCursor.result;
          if (!product) return;
          product.delete();
          product.continue();
        };
      }
      cursor.continue();
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(); };
  });
}
