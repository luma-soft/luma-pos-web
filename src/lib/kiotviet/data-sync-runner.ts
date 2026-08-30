import {
  KIOTVIET_DATA_PHASES,
} from "./data-sync-types";

export const KIOTVIET_SYNC_PHASES = [
  "customers",
  "suppliers",
  "product-references",
  "bookings",
  "sales",
  "purchases",
  "returns",
  "purchase-returns",
] as const;

export type KiotVietSyncPhase = typeof KIOTVIET_SYNC_PHASES[number];
export type KiotVietSyncPhaseArg = KiotVietSyncPhase | "all";

export interface KiotVietInvariantSnapshot {
  stockLevels: { rows: number; quantity: string; reserved: string; fingerprint: string };
  stockMovements: { rows: number; quantity: string; fingerprint: string };
  stockLots: { rows: number; receivedQuantity: string; availableQuantity: string; fingerprint: string };
  stockLotMovements: { rows: number; quantity: string; fingerprint: string };
  customers: { rows: number; currentDebt: string; totalSpent: string; fingerprint: string };
  suppliers: { rows: number; currentDebt: string; fingerprint: string };
  cashTransactions: { rows: number; inAmount: string; outAmount: string; fingerprint: string };
  customerReceivables: {
    entryRows: number;
    entryAmount: string;
    receiptRows: number;
    receiptAmount: string;
    allocationRows: number;
    allocationAmount: string;
    fingerprint: string;
  };
  supplierPayables: {
    entryRows: number;
    entryAmount: string;
    receiptRows: number;
    receiptAmount: string;
    allocationRows: number;
    allocationAmount: string;
    fingerprint: string;
  };
  notifications: { eventRows: number; outboxRows: number; fingerprint: string };
}

export type KiotVietMappingEntityType =
  | "customer"
  | "supplier"
  | "booking"
  | "booking_line"
  | "booking_payment"
  | "sale"
  | "sale_line"
  | "sale_payment"
  | "purchase"
  | "purchase_line"
  | "customer_return"
  | "customer_return_line"
  | "supplier_return"
  | "supplier_return_line";

export type KiotVietMappingAdoptionMethod = "mapped" | "created" | "legacy_adopted";

export interface KiotVietSourceMappingRecord {
  id: string;
  entityType: KiotVietMappingEntityType;
  externalId: string;
  localId: string;
  sourceSha256: string;
  adoptionMethod: KiotVietMappingAdoptionMethod;
  lastSeenRunId: string;
  deletedAt: Date | null;
}

export interface KiotVietDataSyncTransaction {
  captureInvariants(): Promise<KiotVietInvariantSnapshot>;
  completeRun(runId: string, summary: Record<string, unknown>): Promise<void>;
  loadSourceMappings(entityType: KiotVietMappingEntityType): Promise<KiotVietSourceMappingRecord[]>;
  upsertSourceMapping(input: {
    entityType: KiotVietMappingEntityType;
    externalId: string;
    localId: string;
    sourceSha256: string;
    adoptionMethod: KiotVietMappingAdoptionMethod;
    lastSeenRunId: string;
    deletedAt: Date | null;
  }): Promise<string>;
}

export interface KiotVietDataSyncAuditRepository {
  startRun(input: {
    phase: KiotVietSyncPhase;
    sourceFileName: string;
    sourceSha256: string;
    bundleSha256: string | null;
    sourceRows: number;
    sourceDocuments: number;
  }): Promise<string>;
  failRun(runId: string, failure: {
    status: "failed" | "rolled_back";
    errorDetails: { name: string; message: string };
  }): Promise<void>;
}

export interface KiotVietDataSyncArgs {
  directory: string;
  phase: KiotVietSyncPhaseArg;
  storeSlug: string | null;
  apply: boolean;
  reviewedSourceSha256: string | null;
}

export interface KiotVietDataSyncSourceMetadata {
  fileName: string;
  sha256: string;
  bundleSha256: string | null;
  rowCount: number;
  documentCount: number;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isSyncPhase(value: string): value is KiotVietSyncPhase {
  return (KIOTVIET_SYNC_PHASES as readonly string[]).includes(value);
}

export function parseKiotVietDataSyncArgs(argv: string[]): KiotVietDataSyncArgs {
  let directory = "kiotviet_data";
  let phase: KiotVietSyncPhaseArg = "all";
  let storeSlug: string | null = null;
  let apply = false;
  let reviewedSourceSha256: string | null = null;
  let sawDirectory = false;

  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
    } else if (argument.startsWith("--store=")) {
      storeSlug = argument.slice("--store=".length) || null;
    } else if (argument.startsWith("--phase=")) {
      const value = argument.slice("--phase=".length);
      if (value !== "all" && !isSyncPhase(value)) throw new Error(`Unsupported KiotViet phase: ${value}`);
      phase = value;
    } else if (argument.startsWith("--source-sha256=")) {
      reviewedSourceSha256 = argument.slice("--source-sha256=".length).toLowerCase() || null;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unsupported KiotViet sync option: ${argument}`);
    } else if (!sawDirectory) {
      directory = argument;
      sawDirectory = true;
    } else {
      throw new Error(`Unexpected KiotViet sync argument: ${argument}`);
    }
  }

  if (reviewedSourceSha256 && !SHA256_PATTERN.test(reviewedSourceSha256)) {
    throw new Error("--source-sha256 must be 64 lowercase hexadecimal characters");
  }
  if (apply) {
    if (storeSlug !== "hai-dang") throw new Error("--apply requires --store=hai-dang");
    if (phase === "all") throw new Error("--phase=all is dry-run only");
    if (!reviewedSourceSha256) throw new Error("--apply requires --source-sha256");
  }
  return { directory, phase, storeSlug, apply, reviewedSourceSha256 };
}

export function createEmptyKiotVietInvariantSnapshot(): KiotVietInvariantSnapshot {
  return {
    stockLevels: { rows: 0, quantity: "0", reserved: "0", fingerprint: "empty" },
    stockMovements: { rows: 0, quantity: "0", fingerprint: "empty" },
    stockLots: { rows: 0, receivedQuantity: "0", availableQuantity: "0", fingerprint: "empty" },
    stockLotMovements: { rows: 0, quantity: "0", fingerprint: "empty" },
    customers: { rows: 0, currentDebt: "0", totalSpent: "0", fingerprint: "empty" },
    suppliers: { rows: 0, currentDebt: "0", fingerprint: "empty" },
    cashTransactions: { rows: 0, inAmount: "0", outAmount: "0", fingerprint: "empty" },
    customerReceivables: {
      entryRows: 0,
      entryAmount: "0",
      receiptRows: 0,
      receiptAmount: "0",
      allocationRows: 0,
      allocationAmount: "0",
      fingerprint: "empty",
    },
    supplierPayables: {
      entryRows: 0,
      entryAmount: "0",
      receiptRows: 0,
      receiptAmount: "0",
      allocationRows: 0,
      allocationAmount: "0",
      fingerprint: "empty",
    },
    notifications: { eventRows: 0, outboxRows: 0, fingerprint: "empty" },
  };
}

export class KiotVietInvariantViolationError extends Error {
  constructor(changes: string[]) {
    super(`KiotViet invariant violation: ${changes.join("; ")}`);
    this.name = "KiotVietInvariantViolationError";
  }
}

export function assertKiotVietHistoryInvariants(
  phase: KiotVietSyncPhase,
  before: KiotVietInvariantSnapshot,
  after: KiotVietInvariantSnapshot,
): void {
  const allowedDomain = phase === "customers" ? "customers" : phase === "suppliers" ? "suppliers" : null;
  const changes: string[] = [];
  for (const [domain, beforeValues] of Object.entries(before)) {
    if (domain === allowedDomain) continue;
    const afterValues = after[domain as keyof KiotVietInvariantSnapshot] as Record<string, string | number>;
    for (const [field, beforeValue] of Object.entries(beforeValues)) {
      const afterValue = afterValues[field];
      if (afterValue !== beforeValue) {
        changes.push(`${domain}.${field} changed from ${String(beforeValue)} to ${String(afterValue)}`);
      }
    }
  }
  if (changes.length > 0) {
    throw new KiotVietInvariantViolationError(changes);
  }
}

export function assertKiotVietDataSyncApplyGuard(input: {
  apply: boolean;
  phase: KiotVietSyncPhase;
  storeSlug: string | null;
  reviewedSourceSha256: string | null;
  actualSourceSha256: string;
}): void {
  if (!input.apply) return;
  if (input.storeSlug !== "hai-dang") throw new Error("--apply requires --store=hai-dang");
  if (!input.reviewedSourceSha256) throw new Error("--apply requires --source-sha256");
  if (!SHA256_PATTERN.test(input.reviewedSourceSha256) || !SHA256_PATTERN.test(input.actualSourceSha256)) {
    throw new Error("KiotViet source SHA-256 must be 64 lowercase hexadecimal characters");
  }
  if (input.reviewedSourceSha256 !== input.actualSourceSha256) {
    throw new Error("reviewed source SHA-256 does not match the selected workbook");
  }
}

export async function executeKiotVietDataSyncPhase<TSummary extends Record<string, unknown>>(input: {
  apply: boolean;
  phase: KiotVietSyncPhase;
  storeSlug: string | null;
  reviewedSourceSha256: string | null;
  source: KiotVietDataSyncSourceMetadata;
  audit: KiotVietDataSyncAuditRepository;
  runInTransaction: <T>(work: (transaction: KiotVietDataSyncTransaction) => Promise<T>) => Promise<T>;
  work: (transaction: KiotVietDataSyncTransaction, runId: string) => Promise<TSummary>;
}): Promise<{ status: "dry-run"; summary: null } | { status: "completed"; runId: string; summary: TSummary }> {
  assertKiotVietDataSyncApplyGuard({
    apply: input.apply,
    phase: input.phase,
    storeSlug: input.storeSlug,
    reviewedSourceSha256: input.reviewedSourceSha256,
    actualSourceSha256: input.source.sha256,
  });
  if (!input.apply) return { status: "dry-run", summary: null };

  const runId = await input.audit.startRun({
    phase: input.phase,
    sourceFileName: input.source.fileName,
    sourceSha256: input.source.sha256,
    bundleSha256: input.source.bundleSha256,
    sourceRows: input.source.rowCount,
    sourceDocuments: input.source.documentCount,
  });
  try {
    return await input.runInTransaction(async (transaction) => {
      const before = await transaction.captureInvariants();
      const summary = await input.work(transaction, runId);
      const after = await transaction.captureInvariants();
      assertKiotVietHistoryInvariants(input.phase, before, after);
      await transaction.completeRun(runId, summary);
      return { status: "completed" as const, runId, summary };
    });
  } catch (error) {
    const normalized = error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownError", message: String(error) };
    try {
      await input.audit.failRun(runId, {
        status: error instanceof KiotVietInvariantViolationError ? "rolled_back" : "failed",
        errorDetails: normalized,
      });
    } catch (auditError) {
      throw new AggregateError([error, auditError], "KiotViet phase and failure audit both failed");
    }
    throw error;
  }
}

// The runner adds one prerequisite phase; every workbook phase must remain selectable.
for (const phase of KIOTVIET_DATA_PHASES) {
  if (!(KIOTVIET_SYNC_PHASES as readonly string[]).includes(phase)) {
    throw new Error(`KiotViet workbook phase is missing from the runner: ${phase}`);
  }
}
