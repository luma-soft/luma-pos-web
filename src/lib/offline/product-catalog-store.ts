import {
  PRODUCT_CATALOG_SCHEMA_VERSION,
  catalogRevisionChanged,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";

const DB_NAME = "luma-pos-shared";
const DB_VERSION = 1;
const STORE_NAME = "product-catalog";

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T | null = null;
    request.onsuccess = () => {
      result = request.result as T;
    };
    request.onerror = () => {
      result = null;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

export async function readProductCatalogSnapshot(
  scopeId: string,
): Promise<ProductCatalogSnapshot | null> {
  const snapshot = await run<ProductCatalogSnapshot>("readonly", (store) => store.get(scopeId));
  if (
    !snapshot ||
    snapshot.scopeId !== scopeId ||
    snapshot.schemaVersion !== PRODUCT_CATALOG_SCHEMA_VERSION
  ) {
    return null;
  }
  return snapshot;
}

export async function writeProductCatalogSnapshot(
  snapshot: ProductCatalogSnapshot,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    // Compare and write in one transaction: a delayed tab must not overwrite a
    // newer shared catalog written by another tab after a successful mutation.
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(snapshot.scopeId);
    request.onsuccess = () => {
      const current = request.result as ProductCatalogSnapshot | undefined;
      if (
        current?.schemaVersion === snapshot.schemaVersion &&
        catalogRevisionChanged(snapshot.revision, current.revision)
      ) return;
      store.put(snapshot, snapshot.scopeId);
    };
    transaction.oncomplete = transaction.onabort = transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

export async function clearProductCatalogSnapshot(scopeId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(scopeId));
}

export async function clearProductCatalogSnapshotsForUser(userId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const key = String(cursor.key);
      const segments = key.split(":");
      // Current format is storeId:userId:role. Also clear the legacy
      // userId:role format without ever assigning it to a new tenant.
      if (segments[1] === userId || segments[0] === userId) cursor.delete();
      cursor.continue();
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
