import { pathToFileURL } from "node:url";
import { readKiotVietDataBundle } from "../lib/kiotviet/data-sync-files";
import {
  groupKiotVietDocumentRows,
  normalizeKiotVietDate,
  normalizeKiotVietNumber,
  normalizeKiotVietText,
} from "../lib/kiotviet/data-sync-plan";
import type { KiotVietDataPhase } from "../lib/kiotviet/data-sync-types";

/**
 * Links KiotViet documents to documents Luma POS already recorded on its own
 * (the store kept both systems for a while), so a later sync of a full
 * KiotViet export does not create them a second time.
 *
 *   bun run src/scripts/kiotviet-link-documents.ts <export-dir> --store=hai-dang [--days=3] [--apply]
 *
 * A pair is linked only when partner and amount agree and each is the other's
 * nearest candidate in time. Everything else is reported, never guessed. The
 * mapping is stored as `linked`: the POS document stays authoritative and is
 * never updated from KiotViet.
 */

type LinkPhase = Extract<KiotVietDataPhase, "sales" | "purchases" | "returns" | "purchase-returns">;
const ENTITY: Record<LinkPhase, "sale" | "purchase" | "customer_return" | "supplier_return"> = {
  sales: "sale", purchases: "purchase", returns: "customer_return", "purchase-returns": "supplier_return",
};

/**
 * `partner` is the matching class (a partner id, or "walk-in" for any walk-in
 * record); `exactPartner` is the record itself, preferred when both sides of a
 * walk-in pair name the same "Khách lẻ" record.
 */
export interface LinkSource { code: string; at: Date; partner: string | null; exactPartner?: string | null; amounts: number[] }
export interface LinkTarget { localId: string; code: string; at: Date; partner: string | null; exactPartner?: string | null; amount: number }
export interface LinkResult {
  linked: Array<{ source: LinkSource; target: LinkTarget; hours: number; amountDelta: number }>;
  /**
   * KiotViet documents that look like a POS document (same partner, same time
   * window, similar amount, or a twin of one already linked). They are held for
   * review: creating them could duplicate a sale or purchase.
   */
  held: Array<{ source: LinkSource; candidates: LinkTarget[]; reason: string }>;
  /** No plausible POS counterpart: missing from POS, safe to create. */
  unmatched: LinkSource[];
}

const HOUR = 3_600_000;
/** Rounding-level difference between the two systems (VND). */
export const LINK_AMOUNT_TOLERANCE = 1_000;
/** Amount within this share of a POS document makes an unmatched source suspicious. */
const SUSPICIOUS_AMOUNT_SHARE = 0.15;

const amountDelta = (source: LinkSource, target: LinkTarget) =>
  Math.min(...source.amounts.map((amount) => Math.abs(amount - target.amount)));

/**
 * Iterative mutual-nearest matching on partner + amount (within rounding) inside
 * the time window. A pair links only when each side is the other's single
 * nearest candidate; linking a pair can resolve the next round.
 */
export function matchKiotVietDocuments(
  sources: LinkSource[], targets: LinkTarget[], windowDays: number, allTargets: LinkTarget[] = targets,
): LinkResult {
  const window = windowDays * 24 * HOUR;
  const distance = (source: LinkSource, target: LinkTarget) => Math.abs(source.at.getTime() - target.at.getTime());
  const fits = (source: LinkSource, target: LinkTarget) => source.partner === target.partner
    && amountDelta(source, target) <= LINK_AMOUNT_TOLERANCE
    && distance(source, target) <= window;
  const score = (source: LinkSource, target: LinkTarget) => amountDelta(source, target) * 1e9
    + ((source.exactPartner ?? null) === (target.exactPartner ?? null) ? 0 : 1e12)
    + distance(source, target);
  const nearest = <T>(items: T[], rank: (item: T) => number): T | null => {
    const sorted = [...items].sort((left, right) => rank(left) - rank(right));
    if (sorted.length === 0) return null;
    // A tie means two equally plausible partners: not a clear match.
    if (sorted.length > 1 && rank(sorted[0]!) === rank(sorted[1]!)) return null;
    return sorted[0]!;
  };
  const result: LinkResult = { linked: [], held: [], unmatched: [] };
  let openSources = [...sources];
  let openTargets = [...targets];
  for (let progress = true; progress;) {
    progress = false;
    for (const source of openSources) {
      const target = nearest(openTargets.filter((candidate) => fits(source, candidate)), (candidate) => score(source, candidate));
      if (!target) continue;
      const back = nearest(openSources.filter((other) => fits(other, target)), (other) => score(other, target));
      if (back !== source) continue;
      result.linked.push({
        source, target, hours: Math.round(distance(source, target) / HOUR * 10) / 10, amountDelta: amountDelta(source, target),
      });
      openSources = openSources.filter((item) => item !== source);
      openTargets = openTargets.filter((item) => item !== target);
      progress = true;
      break;
    }
  }
  for (const source of openSources) {
    const near = allTargets.filter((target) => target.partner === source.partner && distance(source, target) <= window);
    const open = near.filter((target) => openTargets.includes(target) && fits(source, target));
    const similar = near.filter((target) => source.amounts.some((amount) => (
      Math.abs(amount - target.amount) <= Math.max(LINK_AMOUNT_TOLERANCE, Math.abs(amount) * SUSPICIOUS_AMOUNT_SHARE)
    )));
    if (open.length > 0) result.held.push({ source, candidates: open, reason: "several equally close POS documents" });
    else if (similar.length > 0) result.held.push({ source, candidates: similar, reason: "a POS document with a similar amount exists" });
    else result.unmatched.push(source);
  }
  return result;
}

export async function runKiotVietLinkDocuments(argv: string[]) {
  let directory = "";
  let storeSlug = "";
  let apply = false;
  let windowDays: number | null = null;
  for (const argument of argv) {
    if (argument === "--apply") apply = true;
    else if (argument.startsWith("--store=")) storeSlug = argument.slice("--store=".length);
    else if (argument.startsWith("--days=")) windowDays = Number(argument.slice("--days=".length));
    else if (argument.startsWith("--")) throw new Error(`Unsupported option: ${argument}`);
    else directory = argument;
  }
  if (!directory) throw new Error("Pass the KiotViet export directory");
  if (storeSlug !== "hai-dang") throw new Error("--store=hai-dang is required");
  if (windowDays != null && (!Number.isFinite(windowDays) || windowDays <= 0 || windowDays > 14)) throw new Error("--days must be between 1 and 14");
  // Sales are entered the same day in both systems; purchases and supplier
  // returns were often keyed into POS days later.
  const windowFor = (phase: LinkPhase) => windowDays ?? (phase === "sales" || phase === "returns" ? 3 : 8);

  const bundle = readKiotVietDataBundle(directory);
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { and, eq, inArray, ne } = await import("drizzle-orm");
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, storeSlug)).limit(1);
  if (!store) throw new Error(`Store not found: ${storeSlug}`);
  const storeId = store.id;

  const mappings = await db.select({
    entityType: schema.kiotvietSourceMappings.entityType,
    externalId: schema.kiotvietSourceMappings.externalId,
    localId: schema.kiotvietSourceMappings.localId,
  }).from(schema.kiotvietSourceMappings).where(and(
    eq(schema.kiotvietSourceMappings.storeId, storeId), eq(schema.kiotvietSourceMappings.provider, "kiotviet"),
  ));
  const mapped = (entityType: string) => ({
    external: new Set(mappings.filter((item) => item.entityType === entityType).map((item) => item.externalId)),
    local: new Set(mappings.filter((item) => item.entityType === entityType).map((item) => item.localId)),
  });
  const partnerIndex = async (entityType: "customer" | "supplier") => {
    const table = entityType === "customer" ? schema.customers : schema.suppliers;
    const rows = await db.select({ id: table.id, code: table.code, name: table.name }).from(table).where(eq(table.storeId, storeId));
    const byExternal = new Map<string, string>();
    for (const row of rows) if (row.code) byExternal.set(row.code, row.id);
    for (const mapping of mappings.filter((item) => item.entityType === entityType)) byExternal.set(mapping.externalId, mapping.localId);
    const walkIn = new Set(rows.filter((row) => normalizeKiotVietText(row.name).toLocaleLowerCase("vi") === "khách lẻ"
      || normalizeKiotVietText(row.code).toLocaleLowerCase("vi") === "khách lẻ").map((row) => row.id));
    return { byExternal, walkIn };
  };
  const customers = await partnerIndex("customer");
  const suppliers = await partnerIndex("supplier");
  // Walk-in sales: KiotViet leaves the code blank, POS uses no customer or a "Khách lẻ" record.
  const customerKey = (localId: string | null) => (!localId || customers.walkIn.has(localId) ? "walk-in" : localId);
  const sourceCustomer = (code: string) => {
    const normalized = normalizeKiotVietText(code);
    if (!normalized || normalized.toLocaleLowerCase("vi") === "khách lẻ") return "walk-in";
    const localId = customers.byExternal.get(normalized);
    return localId ? customerKey(localId) : `unknown:${normalized}`;
  };
  const sourceCustomerRecord = (code: string) => {
    const normalized = normalizeKiotVietText(code);
    return normalized ? customers.byExternal.get(normalized) ?? null : null;
  };
  const sourceSupplier = (code: string) => suppliers.byExternal.get(normalizeKiotVietText(code)) ?? `unknown:${code}`;

  const phases: LinkPhase[] = ["sales", "purchases", "returns", "purchase-returns"];
  const report: Array<{ phase: LinkPhase; result: LinkResult; sha256: string; filename: string }> = [];
  for (const phase of phases) {
    const workbook = bundle.sources.find((item) => item.phase === phase)!;
    const entity = ENTITY[phase];
    const known = mapped(entity);
    const documents = groupKiotVietDocumentRows(workbook.rows, { codeColumn: workbook.codeColumn, consistentHeaderColumns: [] })
      .filter((document) => !known.external.has(document.externalId));
    const value = (row: Record<string, unknown>, column: string) => normalizeKiotVietNumber(row[column]);
    const sources: LinkSource[] = documents.map(({ externalId, rows }) => {
      const row = rows[0]!;
      const at = normalizeKiotVietDate(row["Thời gian"]);
      const customerCode = String(row["Mã khách hàng"] ?? "");
      if (phase === "sales") return { code: externalId, at, partner: sourceCustomer(customerCode), exactPartner: sourceCustomerRecord(customerCode), amounts: [value(row, "Khách cần trả")] };
      if (phase === "returns") return { code: externalId, at, partner: sourceCustomer(customerCode), exactPartner: sourceCustomerRecord(customerCode), amounts: [value(row, "Cần trả khách"), value(row, "Tổng tiền hàng trả")] };
      if (phase === "purchases") return { code: externalId, at, partner: sourceSupplier(String(row["Mã nhà cung cấp"] ?? "")), amounts: [value(row, "Cần trả NCC")] };
      return { code: externalId, at, partner: sourceSupplier(String(row["Mã nhà cung cấp"] ?? "")), amounts: [value(row, "NCC cần trả"), value(row, "Tổng tiền hàng trả")] };
    });
    let allTargets: LinkTarget[] = [];
    if (sources.length > 0) {
      if (phase === "sales") {
        const rows = await db.select({ id: schema.orders.id, code: schema.orders.code, at: schema.orders.createdAt, customerId: schema.orders.customerId, total: schema.orders.total })
          .from(schema.orders).where(and(eq(schema.orders.storeId, storeId), eq(schema.orders.documentType, "sale"), ne(schema.orders.status, "cancelled")));
        allTargets = rows.map((row) => ({ localId: row.id, code: row.code, at: row.at, partner: customerKey(row.customerId), exactPartner: row.customerId, amount: Number(row.total) }));
      } else if (phase === "purchases") {
        const rows = await db.select({ id: schema.purchaseOrders.id, code: schema.purchaseOrders.code, at: schema.purchaseOrders.createdAt, supplierId: schema.purchaseOrders.supplierId, total: schema.purchaseOrders.total })
          .from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.storeId, storeId), ne(schema.purchaseOrders.status, "cancelled")));
        allTargets = rows.map((row) => ({ localId: row.id, code: row.code, at: row.at, partner: row.supplierId, amount: Number(row.total) }));
      } else if (phase === "returns") {
        const rows = await db.select({ id: schema.returns.id, code: schema.returns.code, at: schema.returns.createdAt, customerId: schema.returns.customerId, total: schema.returns.totalRefund })
          .from(schema.returns).where(and(eq(schema.returns.storeId, storeId), ne(schema.returns.status, "cancelled")));
        allTargets = rows.map((row) => ({ localId: row.id, code: row.code, at: row.at, partner: customerKey(row.customerId), exactPartner: row.customerId, amount: Number(row.total) }));
      } else {
        const rows = await db.select({ id: schema.purchaseReturns.id, code: schema.purchaseReturns.code, at: schema.purchaseReturns.createdAt, supplierId: schema.purchaseReturns.supplierId, total: schema.purchaseReturns.totalRefund })
          .from(schema.purchaseReturns).where(and(eq(schema.purchaseReturns.storeId, storeId), ne(schema.purchaseReturns.status, "cancelled")));
        allTargets = rows.map((row) => ({ localId: row.id, code: row.code, at: row.at, partner: row.supplierId, amount: Number(row.total) }));
      }
    }
    const targets = allTargets.filter((target) => !known.local.has(target.localId));
    report.push({
      phase, result: matchKiotVietDocuments(sources, targets, windowFor(phase), allTargets),
      sha256: workbook.sha256, filename: workbook.filename,
    });
  }

  if (apply) {
    await db.transaction(async (tx) => {
      for (const { phase, result, sha256, filename } of report) {
        if (result.linked.length === 0) continue;
        const [run] = await tx.insert(schema.kiotvietSyncRuns).values({
          storeId, phase, sourceFileName: `${filename} [link existing POS documents]`, sourceSha256: sha256,
          bundleSha256: bundle.bundleSha256, sourceRows: 0, sourceDocuments: result.linked.length, status: "completed",
          summary: { operation: "link_existing_pos_documents", linked: result.linked.length, windowDays: windowFor(phase) }, completedAt: new Date(),
        }).returning({ id: schema.kiotvietSyncRuns.id });
        const entity = ENTITY[phase];
        // Re-check inside the transaction: never overwrite an existing link.
        const taken = await tx.select({ externalId: schema.kiotvietSourceMappings.externalId, localId: schema.kiotvietSourceMappings.localId })
          .from(schema.kiotvietSourceMappings).where(and(
            eq(schema.kiotvietSourceMappings.storeId, storeId), eq(schema.kiotvietSourceMappings.provider, "kiotviet"),
            eq(schema.kiotvietSourceMappings.entityType, entity),
            inArray(schema.kiotvietSourceMappings.localId, result.linked.map((item) => item.target.localId)),
          ));
        if (taken.length > 0) throw new Error(`${entity} ${taken[0]!.localId} was linked by another run`);
        await tx.insert(schema.kiotvietSourceMappings).values(result.linked.map(({ source, target }) => ({
          storeId, provider: "kiotviet", entityType: entity, externalId: source.code, localId: target.localId,
          sourceSha256: sha256, adoptionMethod: "linked", lastSeenRunId: run!.id,
        })));
      }
    });
  }
  return { applied: apply, report };
}

const fmt = (at: Date) => at.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

async function main() {
  const { applied, report } = await runKiotVietLinkDocuments(process.argv.slice(2));
  console.log(applied ? "APPLIED" : "DRY-RUN");
  for (const { phase, result } of report) {
    console.log(`\n== ${phase}: linked ${result.linked.length} · held ${result.held.length} · not in POS ${result.unmatched.length}`);
    for (const item of result.linked) console.log(`  link ${item.source.code} -> ${item.target.code} (${item.target.amount}${item.amountDelta ? `, lệch ${item.amountDelta}` : ""}, Δ${item.hours}h)`);
    for (const item of result.held) console.log(`  HOLD ${item.source.code} ${fmt(item.source.at)} ${item.source.amounts[0]} (${item.reason}) ~ ${item.candidates.map((candidate) => `${candidate.code} ${candidate.amount}`).join(", ")}`);
    for (const item of result.unmatched) console.log(`  not in POS ${item.code} ${fmt(item.at)} ${item.amounts[0]}`);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
