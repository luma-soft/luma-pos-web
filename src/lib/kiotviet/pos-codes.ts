import { createHash } from "node:crypto";

export type KiotVietPosCodeEntity =
  | "customer"
  | "supplier"
  | "booking"
  | "sale"
  | "purchase"
  | "customer_return"
  | "supplier_return";

/** Same prefixes the POS uses when it creates these records itself. */
export const KIOTVIET_POS_CODE_PREFIX: Record<KiotVietPosCodeEntity, string> = {
  customer: "KH",
  supplier: "NCC",
  booking: "DH",
  sale: "DH",
  purchase: "PN",
  customer_return: "TH",
  supplier_return: "THN",
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Luma POS code for a record created from a KiotViet source.
 *
 * Luma POS owns record codes; the KiotViet code is kept only in
 * `kiotviet_source_mappings`. The shape matches `generateCode()`
 * (`PREFIXYYMMDDHHMMSSxx`, UTC like the POS server clock), but the timestamp
 * comes from the source record and the suffix is derived from the KiotViet
 * identity, so the same source always proposes the same code. `attempt` moves
 * to the next candidate when a code is already taken.
 */
export function kiotVietPosCode(
  entity: KiotVietPosCodeEntity,
  externalId: string,
  at: Date,
  attempt = 0,
): string {
  if (!externalId.trim()) throw new Error(`KiotViet ${entity} external ID cannot be blank`);
  if (Number.isNaN(at.getTime())) throw new Error(`KiotViet ${entity} ${externalId} has an invalid timestamp`);
  const date = `${String(at.getUTCFullYear()).slice(2)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  const digest = createHash("sha256").update(`${entity}\0${externalId}\0${attempt}`).digest("hex");
  const suffix = BigInt(`0x${digest.slice(0, 12)}`).toString(36).toUpperCase().padStart(2, "0").slice(-2);
  return `${KIOTVIET_POS_CODE_PREFIX[entity]}${date}${time}${suffix}`;
}

/** Codes that still carry a KiotViet identity rather than a Luma POS code. */
export function isKiotVietStyleCode(code: string): boolean {
  return /^(HD|DH|PN|TH|THN|KH|NCC)\d{6}(\.\d+)?$/.test(code.trim());
}

/**
 * Presents mapped local rows to the planner under their KiotViet identity.
 * Fingerprints, partner resolution and duplicate detection then compare source
 * identities instead of the Luma POS display code stored on the record.
 */
export function withKiotVietSourceIdentities<T extends { localId: string; code: string | null }>(
  rows: T[],
  externalIdByLocalId: ReadonlyMap<string, string>,
): T[] {
  for (const row of rows) {
    const externalId = externalIdByLocalId.get(row.localId);
    if (externalId) row.code = externalId;
  }
  return rows;
}
