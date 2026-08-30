export const KIOTVIET_DATA_PHASES = [
  "customers",
  "suppliers",
  "bookings",
  "sales",
  "purchases",
  "returns",
  "purchase-returns",
] as const;

export type KiotVietDataPhase = typeof KIOTVIET_DATA_PHASES[number];
export type KiotVietDataRow = Record<string, unknown>;

export interface KiotVietWorkbookSource {
  phase: KiotVietDataPhase;
  filename: string;
  path: string;
  sha256: string;
  headers: string[];
  rows: KiotVietDataRow[];
  rowCount: number;
  documentCount: number;
  codeColumn: string;
}

export interface KiotVietDataBundle {
  sources: KiotVietWorkbookSource[];
  bundleSha256: string;
}

export interface KiotVietSourceEntitySnapshot {
  externalId: string;
  fingerprint: string;
}

export interface KiotVietCurrentEntitySnapshot {
  localId: string;
  code: string | null;
  fingerprint: string;
  legacyImported: boolean;
}

export interface KiotVietEntityMappingSnapshot {
  externalId: string;
  localId: string;
}

export interface KiotVietEntitySyncPlan {
  creates: Array<{ externalId: string }>;
  adopts: Array<{ externalId: string; localId: string; needsUpdate: boolean }>;
  updates: Array<{ externalId: string; localId: string }>;
  unchanged: Array<{ externalId: string; localId: string }>;
  conflicts: Array<{
    externalId: string;
    localId: string;
    reason: "code_collision" | "mapped_local_missing";
  }>;
  preserves: Array<{ localId: string; code: string }>;
}
