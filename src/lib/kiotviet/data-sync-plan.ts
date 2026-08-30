import { createHash } from "node:crypto";
import type {
  KiotVietCurrentEntitySnapshot,
  KiotVietDataRow,
  KiotVietEntityMappingSnapshot,
  KiotVietEntitySyncPlan,
  KiotVietSourceEntitySnapshot,
} from "./data-sync-types";

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000;

function vietnamWallClockToDate(wallClockUtcMs: number): Date {
  return new Date(Math.round(wallClockUtcMs / 1_000) * 1_000 - VIETNAM_UTC_OFFSET_MS);
}

export function normalizeKiotVietText(value: unknown): string {
  return value == null ? "" : String(value).trim().normalize("NFC");
}

export function normalizeKiotVietNumber(value: unknown): number {
  if (value == null || value === "" || value === "--") return 0;
  const parsed = typeof value === "number"
    ? value
    : Number(normalizeKiotVietText(value).replaceAll("\u00a0", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid KiotViet number: ${String(value)}`);
  return parsed;
}

export function normalizeKiotVietDate(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid KiotViet date");
    return new Date(value.getTime());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return vietnamWallClockToDate((value - 25569) * 86_400_000);
  }
  const text = normalizeKiotVietText(value);
  const localMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localMatch) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = localMatch;
    const wallClockUtcMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
    const wallClock = new Date(wallClockUtcMs);
    if (
      wallClock.getUTCFullYear() !== +year
      || wallClock.getUTCMonth() !== +month - 1
      || wallClock.getUTCDate() !== +day
    ) throw new Error(`Invalid KiotViet date: ${text}`);
    return vietnamWallClockToDate(wallClockUtcMs);
  }
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    const wallClockUtcMs = Date.UTC(+year, +month - 1, +day);
    const date = new Date(wallClockUtcMs);
    if (
      date.getUTCFullYear() === +year
      && date.getUTCMonth() === +month - 1
      && date.getUTCDate() === +day
    ) return vietnamWallClockToDate(wallClockUtcMs);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error(`Invalid KiotViet date: ${text}`);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Cannot fingerprint a non-finite number");
  }
  return value;
}

export function stableKiotVietFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function withoutKiotVietExternalId<T extends { externalId: string }>(
  value: T,
): Omit<T, "externalId"> {
  const result: Partial<T> = { ...value };
  delete result.externalId;
  return result as Omit<T, "externalId">;
}

export function assertUniqueKiotVietCodes(
  rows: KiotVietDataRow[],
  codeColumn: string,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const code = normalizeKiotVietText(row[codeColumn]);
    if (!code) throw new Error(`Blank KiotViet source identity in ${codeColumn}`);
    if (seen.has(code)) throw new Error(`Duplicate KiotViet source identity: ${code}`);
    seen.add(code);
  }
}

export function groupKiotVietDocumentRows(
  rows: KiotVietDataRow[],
  input: { codeColumn: string; consistentHeaderColumns: string[] },
): Array<{ externalId: string; rows: KiotVietDataRow[] }> {
  const groups = new Map<string, KiotVietDataRow[]>();
  for (const row of rows) {
    const externalId = normalizeKiotVietText(row[input.codeColumn]);
    if (!externalId) throw new Error(`Blank KiotViet source identity in ${input.codeColumn}`);
    const group = groups.get(externalId) ?? [];
    group.push(row);
    groups.set(externalId, group);
  }

  const result = [...groups].map(([externalId, groupRows]) => {
    const first = groupRows[0]!;
    for (const row of groupRows.slice(1)) {
      for (const column of input.consistentHeaderColumns) {
        if (stableKiotVietFingerprint(row[column]) !== stableKiotVietFingerprint(first[column])) {
          throw new Error(`Contradictory KiotViet header ${column} in ${externalId}`);
        }
      }
    }
    return { externalId, rows: groupRows };
  });
  return result.sort((left, right) => left.externalId.localeCompare(right.externalId));
}

export interface KiotVietDocumentReconciliationRules {
  codeColumn: string;
  headerTotalColumn: string;
  lineTotalColumn?: string;
  lineQuantityColumn?: string;
  lineUnitPriceColumn?: string;
  roundEachLine?: boolean;
  payableColumn: string;
  subtractHeaderColumns?: string[];
  addHeaderColumns?: string[];
  paidColumn?: string;
  paymentColumns?: string[];
  paymentAbsolute?: boolean;
  tolerance?: number;
}

function reconciliationLineTotal(
  row: KiotVietDataRow,
  rules: KiotVietDocumentReconciliationRules,
): number {
  if (rules.lineTotalColumn) return normalizeKiotVietNumber(row[rules.lineTotalColumn]);
  if (!rules.lineQuantityColumn || !rules.lineUnitPriceColumn) {
    throw new Error("KiotViet reconciliation requires a line total or quantity/unit-price columns");
  }
  const total = normalizeKiotVietNumber(row[rules.lineQuantityColumn])
    * normalizeKiotVietNumber(row[rules.lineUnitPriceColumn]);
  return rules.roundEachLine ? Math.round(total) : total;
}

function assertReconciledAmount(
  externalId: string,
  label: string,
  actual: number,
  expected: number,
  tolerance: number,
): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `KiotViet ${label} in ${externalId}: expected ${expected}, received ${actual}`,
    );
  }
}

export function assertKiotVietDocumentReconciliation(
  rows: KiotVietDataRow[],
  rules: KiotVietDocumentReconciliationRules,
): void {
  const tolerance = rules.tolerance ?? 0.011;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("KiotViet reconciliation tolerance must be non-negative");
  }
  for (const group of groupKiotVietDocumentRows(rows, {
    codeColumn: rules.codeColumn,
    consistentHeaderColumns: [],
  })) {
    const header = group.rows[0]!;
    const headerTotal = normalizeKiotVietNumber(header[rules.headerTotalColumn]);
    const lineTotal = group.rows.reduce(
      (sum, row) => sum + reconciliationLineTotal(row, rules),
      0,
    );
    assertReconciledAmount(group.externalId, "line total mismatch", lineTotal, headerTotal, tolerance);

    const payable = headerTotal
      - (rules.subtractHeaderColumns ?? []).reduce(
        (sum, column) => sum + normalizeKiotVietNumber(header[column]),
        0,
      )
      + (rules.addHeaderColumns ?? []).reduce(
        (sum, column) => sum + normalizeKiotVietNumber(header[column]),
        0,
      );
    assertReconciledAmount(
      group.externalId,
      "payable total mismatch",
      normalizeKiotVietNumber(header[rules.payableColumn]),
      payable,
      tolerance,
    );

    if (rules.paidColumn || rules.paymentColumns) {
      if (!rules.paidColumn || !rules.paymentColumns?.length) {
        throw new Error("KiotViet payment reconciliation requires paid and payment columns");
      }
      let paid = normalizeKiotVietNumber(header[rules.paidColumn]);
      let paymentTotal = rules.paymentColumns.reduce(
        (sum, column) => sum + normalizeKiotVietNumber(header[column]),
        0,
      );
      if (rules.paymentAbsolute) {
        paid = Math.abs(paid);
        paymentTotal = Math.abs(paymentTotal);
      }
      assertReconciledAmount(
        group.externalId,
        "payment total mismatch",
        paymentTotal,
        paid,
        tolerance,
      );
    }
  }
}

function escapeExternalIdSegment(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

export function buildKiotVietChildExternalId(input: {
  documentCode: string;
  sku: string;
  unitName: string;
  occurrence: number;
}): string {
  if (!Number.isSafeInteger(input.occurrence) || input.occurrence <= 0) {
    throw new Error("KiotViet child identity requires a positive occurrence");
  }
  const documentCode = normalizeKiotVietText(input.documentCode);
  const sku = normalizeKiotVietText(input.sku);
  const unitName = normalizeKiotVietText(input.unitName).toLocaleLowerCase("vi");
  if (!documentCode || !sku) throw new Error("KiotViet child identity requires document code and SKU");
  return [documentCode, sku, unitName, String(input.occurrence)]
    .map(escapeExternalIdSegment)
    .join("|");
}

function uniqueMap<T>(
  values: T[],
  keyOf: (value: T) => string,
  duplicateLabel: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizeKiotVietText(keyOf(value));
    if (!key) throw new Error(`Blank KiotViet ${duplicateLabel}`);
    if (result.has(key)) throw new Error(`Duplicate KiotViet ${duplicateLabel}: ${key}`);
    result.set(key, value);
  }
  return result;
}

export function planKiotVietEntities(input: {
  sources: KiotVietSourceEntitySnapshot[];
  current: KiotVietCurrentEntitySnapshot[];
  mappings: KiotVietEntityMappingSnapshot[];
}): KiotVietEntitySyncPlan {
  const sources = uniqueMap(input.sources, (source) => source.externalId, "source identity");
  const currentById = uniqueMap(input.current, (current) => current.localId, "local identity");
  const currentByCode = new Map<string, KiotVietCurrentEntitySnapshot>();
  for (const current of input.current) {
    const code = normalizeKiotVietText(current.code);
    if (!code) continue;
    if (currentByCode.has(code)) throw new Error(`Duplicate KiotViet current code: ${code}`);
    currentByCode.set(code, current);
  }
  const mappingByExternalId = uniqueMap(input.mappings, (mapping) => mapping.externalId, "mapping identity");
  const usedLocalIds = new Set<string>();
  const plan: KiotVietEntitySyncPlan = {
    creates: [],
    adopts: [],
    updates: [],
    unchanged: [],
    conflicts: [],
    preserves: [],
  };

  for (const [externalId, source] of sources) {
    const mapping = mappingByExternalId.get(externalId);
    if (mapping) {
      const local = currentById.get(mapping.localId);
      if (!local) {
        plan.conflicts.push({
          externalId,
          localId: mapping.localId,
          reason: "mapped_local_missing",
        });
        continue;
      }
      usedLocalIds.add(local.localId);
      if (local.fingerprint === source.fingerprint) {
        plan.unchanged.push({ externalId, localId: local.localId });
      } else {
        plan.updates.push({ externalId, localId: local.localId });
      }
      continue;
    }

    const codeMatch = currentByCode.get(externalId);
    if (!codeMatch) {
      plan.creates.push({ externalId });
      continue;
    }
    usedLocalIds.add(codeMatch.localId);
    if (codeMatch.legacyImported || codeMatch.fingerprint === source.fingerprint) {
      plan.adopts.push({
        externalId,
        localId: codeMatch.localId,
        needsUpdate: codeMatch.fingerprint !== source.fingerprint,
      });
    } else {
      plan.conflicts.push({
        externalId,
        localId: codeMatch.localId,
        reason: "code_collision",
      });
    }
  }

  for (const current of input.current) {
    if (!usedLocalIds.has(current.localId)) {
      plan.preserves.push({ localId: current.localId, code: normalizeKiotVietText(current.code) });
    }
  }

  const byExternalId = <T extends { externalId: string }>(left: T, right: T) =>
    left.externalId.localeCompare(right.externalId);
  plan.creates.sort(byExternalId);
  plan.adopts.sort(byExternalId);
  plan.updates.sort(byExternalId);
  plan.unchanged.sort(byExternalId);
  plan.conflicts.sort(byExternalId);
  plan.preserves.sort((left, right) => left.code.localeCompare(right.code));
  return plan;
}
