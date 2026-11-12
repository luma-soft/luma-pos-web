import type { ServiceFieldMutationRelayPayload } from "@/lib/sync/relay";

const DATABASE_NAME = "luma-service-offline";
const DATABASE_VERSION = 1;
const CHECKLIST_STORE = "checklists";

export type ServiceChecklistQueueEntry = {
  storageId: string;
  scopeId: string;
  storeId: string;
  jobId: string;
  eventId: string;
  payload: Extract<ServiceFieldMutationRelayPayload, { type: "checklist.update" }>;
  savedAt: number;
  failed?: boolean;
  errorCode?: string;
};

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHECKLIST_STORE)) {
        db.createObjectStore(CHECKLIST_STORE, { keyPath: "storageId" });
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
  const db = await openDatabase();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    const transaction = db.transaction(CHECKLIST_STORE, mode);
    const request = operation(transaction.objectStore(CHECKLIST_STORE));
    let succeeded = false;
    let result: T | null = null;
    request.onsuccess = () => {
      succeeded = true;
      result = request.result == null ? null : request.result as T;
    };
    request.onerror = () => { succeeded = false; };
    transaction.oncomplete = () => resolve(succeeded ? result : null);
    transaction.onerror = transaction.onabort = () => resolve(null);
  }).catch(() => null);
}

function storageId(scopeId: string, jobId: string) {
  return `${scopeId}:${jobId}`;
}

export async function getServiceChecklistQueueEntry(
  scopeId: string,
  jobId: string,
): Promise<ServiceChecklistQueueEntry | null> {
  const entry = await run<ServiceChecklistQueueEntry>("readonly", (store) => store.get(storageId(scopeId, jobId)));
  return entry?.scopeId === scopeId && entry.jobId === jobId ? entry : null;
}

export async function saveServiceChecklistQueueEntry(
  entry: Omit<ServiceChecklistQueueEntry, "storageId">,
): Promise<boolean> {
  const saved = await run<IDBValidKey>("readwrite", (store) => store.put({
    ...entry,
    storageId: storageId(entry.scopeId, entry.jobId),
  }));
  return saved != null;
}

export async function markServiceChecklistQueueEntryFailed(
  scopeId: string,
  jobId: string,
  errorCode: string,
): Promise<void> {
  const entry = await getServiceChecklistQueueEntry(scopeId, jobId);
  if (!entry) return;
  await run("readwrite", (store) => store.put({ ...entry, failed: true, errorCode }));
}

export async function removeServiceChecklistQueueEntry(scopeId: string, jobId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(storageId(scopeId, jobId)));
}
