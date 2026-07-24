/**
 * Hàng đợi đơn bán offline của POS (IndexedDB, không phụ thuộc thư viện).
 * Product Catalog đã chuyển sang module offline dùng chung toàn app.
 * Mọi hàm an toàn ở client; trả về giá trị mặc định nếu IndexedDB không khả dụng.
 */
const DB_NAME = "sales-pos-offline";
const DB_VER = 2;

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Catalog v1 không tách user và chỉ chứa một phần danh mục; xóa khi
      // chuyển sang Product Catalog dùng chung đã được scope theo user/role.
      if (db.objectStoreNames.contains("catalog")) db.deleteObjectStore("catalog");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "localId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function run<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    });
  });
}

// ---- outbox ----
export interface OutboxOrder {
  localId: string;
  payload: unknown;   // input của createOrder
  savedAt: number;
  failed?: boolean;
  failReason?: string;
}
export async function enqueueOrder(rec: OutboxOrder): Promise<void> {
  await run("outbox", "readwrite", (s) => s.put(rec));
}
export async function getOutbox(): Promise<OutboxOrder[]> {
  const all = await run<OutboxOrder[]>("outbox", "readonly", (s) => s.getAll());
  return all ?? [];
}
export async function removeOutbox(localId: string): Promise<void> {
  await run("outbox", "readwrite", (s) => s.delete(localId));
}
export async function markFailed(localId: string, reason: string): Promise<void> {
  const item = await run<OutboxOrder>("outbox", "readonly", (s) => s.get(localId));
  if (item) await run("outbox", "readwrite", (s) => s.put({ ...item, failed: true, failReason: reason }));
}
