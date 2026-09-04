/** Shared, side-effect-free policy for the product editor's save confirmation. */
export type EditablePriceUnit = {
  id?: string;
  unitName: string;
  multiplier: number;
  priceOverride?: number | null;
};

export type UnitPricingSnapshot = {
  baseUnit: string;
  retailPrice: number;
  costPrice?: number;
  priceBookPrices?: Record<string, number | null>;
  units: EditablePriceUnit[];
};

export type UnitPriceBook = { key: string; label: string; kind: "list" | "custom" };
export type UnitPriceChoice = "keep" | "sync";
export type UnitPricePreviewRow = {
  key: string;
  unitName: string;
  multiplier: number;
  before: number | null;
  after: number | null;
  mode: "base" | "fixed" | "linked" | "removed";
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const unitKey = (unit: EditablePriceUnit) => `unit:${unit.id ?? unit.unitName}`;
const fixedPrice = (unit: EditablePriceUnit) => unit.priceOverride ?? null;
const alternates = (snapshot: UnitPricingSnapshot) => snapshot.units.filter(
  (unit) => !(unit.unitName === snapshot.baseUnit && unit.multiplier === 1),
);
const previousUnit = (units: EditablePriceUnit[], next: EditablePriceUnit) =>
  units.find((unit) => next.id ? unit.id === next.id : unit.unitName === next.unitName);

/** Match the database's money (2dp) and multiplier (4dp) precision before review. */
export function normalizeUnitPriceDraft<T extends UnitPricingSnapshot>(draft: T): T {
  const units = draft.units.map((unit) => {
    const multiplier = Math.round(unit.multiplier * 10000) / 10000;
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Hệ số quy đổi phải từ 0,0001 trở lên.");
    return { ...unit, multiplier, priceOverride: unit.priceOverride == null ? null : cents(unit.priceOverride) };
  });
  return {
    ...draft, units, retailPrice: cents(draft.retailPrice),
    ...(draft.costPrice != null ? { costPrice: cents(draft.costPrice) } : {}),
    priceBookPrices: Object.fromEntries(Object.entries(draft.priceBookPrices ?? {}).map(([key, price]) => [key, price == null ? null : cents(price)])),
  };
}

function unitPrice(snapshot: UnitPricingSnapshot, unit: EditablePriceUnit | undefined, book?: UnitPriceBook | "cost") {
  const base = book === "cost" ? snapshot.costPrice ?? null
    : book ? snapshot.priceBookPrices?.[book.key] ?? (book.kind === "custom" ? snapshot.retailPrice : null)
    : snapshot.retailPrice;
  if (base == null || !unit) return base;
  if (!book && fixedPrice(unit) != null) return fixedPrice(unit);
  if (book !== "cost" && book?.kind === "custom" && fixedPrice(unit) != null) {
    return Math.round(fixedPrice(unit)! * (snapshot.retailPrice > 0 ? base / snapshot.retailPrice : 1));
  }
  return Math.round(base * unit.multiplier);
}

function previewRows(before: UnitPricingSnapshot, after: UnitPricingSnapshot, book?: UnitPriceBook | "cost"): UnitPricePreviewRow[] {
  const oldUnits = alternates(before);
  const newUnits = alternates(after);
  const rows: UnitPricePreviewRow[] = [{
    key: "base", unitName: after.baseUnit, multiplier: 1,
    before: unitPrice(before, undefined, book), after: unitPrice(after, undefined, book), mode: "base",
  }];
  for (const unit of newUnits) {
    const old = previousUnit(oldUnits, unit);
    rows.push({
      key: unitKey(unit), unitName: unit.unitName, multiplier: unit.multiplier,
      before: old ? unitPrice(before, old, book) : null,
      after: unitPrice(after, unit, book),
      mode: !book && fixedPrice(unit) != null ? "fixed" : "linked",
    });
  }
  for (const old of oldUnits) {
    if (newUnits.some((unit) => previousUnit([old], unit))) continue;
    rows.push({ key: unitKey(old), unitName: old.unitName, multiplier: old.multiplier, before: unitPrice(before, old, book), after: null, mode: "removed" });
  }
  return rows;
}

export function buildUnitPriceReview(before: UnitPricingSnapshot, after: UnitPricingSnapshot, books: UnitPriceBook[] = []) {
  before = normalizeUnitPriceDraft(before);
  after = normalizeUnitPriceDraft(after);
  const oldUnits = alternates(before);
  const newUnits = alternates(after);
  const unitChanged = oldUnits.length !== newUnits.length || newUnits.some((unit) => {
    const old = previousUnit(oldUnits, unit);
    return !old || old.multiplier !== unit.multiplier || fixedPrice(old) !== fixedPrice(unit);
  });
  const canSynchronize = before.retailPrice !== after.retailPrice || unitChanged || before.baseUnit !== after.baseUnit;
  const sources = [
    { key: "base", label: after.baseUnit, amount: after.retailPrice, multiplier: 1, changed: before.retailPrice !== after.retailPrice },
    ...newUnits.filter((unit) => fixedPrice(unit) != null).map((unit) => ({
      key: unitKey(unit), label: unit.unitName, amount: fixedPrice(unit)!, multiplier: unit.multiplier,
      changed: fixedPrice(previousUnit(oldUnits, unit) ?? { ...unit, priceOverride: null }) !== fixedPrice(unit),
    })),
  ];
  const changedSources = sources.filter((source) => source.changed);
  const normalized = new Set(changedSources.map((source) => cents(source.amount / source.multiplier)));
  const suggestedSource = normalized.size > 1 ? null : changedSources[0]?.key ?? "base";
  const additionalBooks: { key: string; label: string; rows: UnitPricePreviewRow[] }[] = [];
  const costRows = previewRows(before, after, "cost");
  if (before.costPrice !== after.costPrice || costRows.some((row) => row.before !== row.after)) {
    additionalBooks.push({ key: "cost", label: "Giá vốn", rows: costRows });
  }
  const bookIds = new Set([...books.map((book) => book.key), ...Object.keys(before.priceBookPrices ?? {}), ...Object.keys(after.priceBookPrices ?? {})]);
  for (const key of bookIds) {
    const book = books.find((candidate) => candidate.key === key) ?? { key, label: key, kind: "list" as const };
    const rows = previewRows(before, after, book);
    if ((before.priceBookPrices?.[key] ?? null) !== (after.priceBookPrices?.[key] ?? null) || rows.some((row) => row.before !== row.after)) {
      additionalBooks.push({ key, label: book.label, rows });
    }
  }
  return {
    required: (oldUnits.length > 0 || newUnits.length > 0) && (canSynchronize || additionalBooks.length > 0),
    canSynchronize,
    sources,
    suggestedSource,
    retailRows: previewRows(before, after),
    additionalBooks,
  };
}

export function applyUnitPriceChoice<T extends UnitPricingSnapshot>(draft: T, mode: UnitPriceChoice, sourceKey?: string | null): T {
  draft = normalizeUnitPriceDraft(draft);
  if (mode === "keep") return draft;
  const unit = sourceKey === "base" ? undefined : alternates(draft).find((candidate) => unitKey(candidate) === sourceKey && fixedPrice(candidate) != null);
  if (sourceKey !== "base" && !unit) throw new Error("Choose a valid price source before synchronizing");
  const base = unit ? fixedPrice(unit)! / unit.multiplier : draft.retailPrice;
  if (!Number.isFinite(base) || base < 0) throw new Error("Invalid price source");
  return {
    ...draft,
    retailPrice: cents(base),
    units: draft.units.map((unit) => ({ ...unit, priceOverride: null })),
  };
}
