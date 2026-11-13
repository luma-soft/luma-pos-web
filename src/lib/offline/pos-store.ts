/**
 * Hàng đợi đơn bán offline của POS (IndexedDB, không phụ thuộc thư viện).
 * Product Catalog đã chuyển sang module offline dùng chung toàn app.
 * Mọi hàm an toàn ở client; trả về giá trị mặc định nếu IndexedDB không khả dụng.
 */
const DB_NAME = "sales-pos-offline";
const DB_VER = 4;
const OUTBOX_STORE = "outbox";
const LEGACY_OUTBOX_STORE = "legacy-outbox-quarantine";

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // IDBRequest.transaction is nullable in general, but is present while
      // handling the upgradeneeded event for this open request.
      const transaction = req.transaction!;
      const previousVersion = event.oldVersion;
      // Catalog v1 không tách user và chỉ chứa một phần danh mục; xóa khi
      // chuyển sang Product Catalog dùng chung đã được scope theo user/role.
      if (previousVersion < 2 && db.objectStoreNames.contains("catalog")) {
        db.deleteObjectStore("catalog");
      }

      if (!db.objectStoreNames.contains(LEGACY_OUTBOX_STORE)) {
        db.createObjectStore(LEGACY_OUTBOX_STORE, { keyPath: "quarantineId" });
      }

      const hasOutbox = db.objectStoreNames.contains(OUTBOX_STORE);
      if (previousVersion > 0 && previousVersion < 3 && hasOutbox) {
        // The v2 outbox was keyed only by localId and had no tenant scope. Keep
        // its rows out of the active queue so they can never be replayed under
        // a different account, but preserve them for owner-assisted recovery.
        const legacyOutbox = transaction.objectStore(OUTBOX_STORE);
        const quarantine = transaction.objectStore(LEGACY_OUTBOX_STORE);
        const cursorRequest = legacyOutbox.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor) {
            quarantine.put({
              quarantineId: `${previousVersion}:${String(cursor.primaryKey)}`,
              sourceVersion: previousVersion,
              sourceKey: String(cursor.primaryKey),
              quarantinedAt: Date.now(),
              record: cursor.value,
            });
            cursor.continue();
            return;
          }

          db.deleteObjectStore(OUTBOX_STORE);
          db.createObjectStore(OUTBOX_STORE, { keyPath: "storageId" });
        };
      } else if (!hasOutbox) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "storageId" });
      }
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
      let requestSucceeded = false;
      let result: T | null = null;
      req.onsuccess = () => {
        requestSucceeded = true;
        result = req.result == null ? null : req.result as T;
      };
      req.onerror = () => { requestSucceeded = false; };
      tx.oncomplete = () => resolve(requestSucceeded ? result : null);
      tx.onerror = tx.onabort = () => resolve(null);
    });
  }).catch(() => null);
}

// ---- outbox ----
export interface OutboxOrder {
  storageId: string;
  scopeId: string;
  localId: string;
  eventId?: string;
  relayPosition?: string;
  payload: unknown;   // input của createOrder
  savedAt: number;
  failed?: boolean;
  failReason?: string;
}

export type QuarantinedOutboxOrder = {
  quarantineId: string;
  sourceVersion: number;
  sourceKey: string;
  quarantinedAt: number;
  record: unknown;
};

export async function getQuarantinedOutboxCount(): Promise<number> {
  return (await run<number>(LEGACY_OUTBOX_STORE, "readonly", (store) => store.count())) ?? 0;
}

export async function getQuarantinedOutbox(): Promise<QuarantinedOutboxOrder[]> {
  return (await run<QuarantinedOutboxOrder[]>(LEGACY_OUTBOX_STORE, "readonly", (store) => store.getAll())) ?? [];
}

export async function enqueueOrder(
  scopeId: string,
  rec: Omit<OutboxOrder, "storageId" | "scopeId">,
): Promise<boolean> {
  const key = await run<IDBValidKey>("outbox", "readwrite", (s) => s.put({
    ...rec,
    scopeId,
    storageId: `${scopeId}:${rec.localId}`,
  }));
  return key != null;
}
export async function getOutbox(scopeId: string): Promise<OutboxOrder[]> {
  const all = await run<OutboxOrder[]>("outbox", "readonly", (s) => s.getAll());
  return (all ?? []).filter((item) => item.scopeId === scopeId).sort((a, b) => a.savedAt - b.savedAt);
}
export async function removeOutbox(scopeId: string, localId: string): Promise<void> {
  await run("outbox", "readwrite", (s) => s.delete(`${scopeId}:${localId}`));
}
export async function markFailed(scopeId: string, localId: string, reason: string): Promise<void> {
  const storageId = `${scopeId}:${localId}`;
  const item = await run<OutboxOrder>("outbox", "readonly", (s) => s.get(storageId));
  if (item) await run("outbox", "readwrite", (s) => s.put({ ...item, failed: true, failReason: reason }));
}

export async function storeRelaySubmission(
  scopeId: string,
  localId: string,
  eventId: string,
  position: string,
): Promise<OutboxOrder | null> {
  const storageId = `${scopeId}:${localId}`;
  const item = await run<OutboxOrder>("outbox", "readonly", (s) => s.get(storageId));
  if (!item || item.scopeId !== scopeId) return null;
  const updated = { ...item, eventId, relayPosition: position };
  await run("outbox", "readwrite", (s) => s.put(updated));
  return updated;
}

export async function storeRelayEventId(
  scopeId: string,
  localId: string,
  eventId: string,
): Promise<OutboxOrder | null> {
  const storageId = `${scopeId}:${localId}`;
  const item = await run<OutboxOrder>("outbox", "readonly", (s) => s.get(storageId));
  if (!item || item.scopeId !== scopeId) return null;
  const updated = { ...item, eventId: item.eventId || eventId };
  await run("outbox", "readwrite", (s) => s.put(updated));
  return updated;
}

export function getOrCreateSyncDeviceId(): string {
  const key = "luma.sync.device-id.v1";
  if (typeof localStorage === "undefined") return crypto.randomUUID();
  try {
    const existing = localStorage.getItem(key)?.trim();
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
