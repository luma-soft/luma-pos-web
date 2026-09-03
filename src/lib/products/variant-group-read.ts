import { createHash } from "node:crypto";
import { buildVariantCombinations, normalizeVariantAttributes, variantCombinationBudget, variantCombinationKey, variantNameKey, type NormalizedVariantAttribute } from "./variant-model";

export type VariantCatalogEntry = { id: string; name: string; aliases: string[] };
export type StoredVariantGroup = {
  id: string;
  kind: "native" | "related";
  attributes: NormalizedVariantAttribute[];
  excludedCombinationKeys: string[];
  revision: number;
  requiresReview: boolean;
};
export type StoredVariantMember = { productId: string; combinationKey: string | null; optionValueIds: string[] };
type VariantReadMember = {
  id: string; specs: unknown; baseUnit: string;
  totalStock: string; costPrice: string; retailPrice: string;
};

/** Same deterministic ID as the metadata-only backfill; it survives catalog renaming. */
function legacyValueId(attributeId: string, value: string) {
  const hex = createHash("md5").update(`${attributeId}:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function projectVariantGroup<T extends VariantReadMember>(input: {
  id: string; name: string; kind: "native" | "related"; members: T[];
  catalog: VariantCatalogEntry[]; stored?: StoredVariantGroup; identities?: StoredVariantMember[];
}) {
  const catalogNames = new Map(input.catalog.flatMap((attribute) => [attribute.name, ...attribute.aliases]
    .map((name) => [variantNameKey(name), attribute] as const)));
  const visibleSpecs = input.members.map((member) => Object.entries(member.specs && typeof member.specs === "object" && !Array.isArray(member.specs) ? member.specs : {})
    .filter(([name]) => !name.startsWith("__"))
    .map(([name, values]) => ({ name, catalog: catalogNames.get(variantNameKey(name)), values: Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [] })));
  let requiresReview = input.stored?.requiresReview ?? false;
  const collected = new Map<string, { attributeId: string; name: string; values: Set<string> }>();
  for (const specs of visibleSpecs) for (const spec of specs) {
    const attributeId = spec.catalog?.id ?? `attribute:${variantNameKey(spec.name)}`;
    const axis = collected.get(attributeId) ?? { attributeId, name: spec.catalog?.name ?? spec.name, values: new Set<string>() };
    spec.values.forEach((value) => axis.values.add(value.trim()));
    collected.set(attributeId, axis);
  }
  let attributes: NormalizedVariantAttribute[] = [];
  try {
    attributes = normalizeVariantAttributes(input.stored?.attributes.length ? input.stored.attributes.map((axis) => ({
      ...axis, name: input.catalog.find((entry) => entry.id === axis.attributeId)?.name ?? axis.name,
    })) : [...collected.values()].sort((a, b) => a.attributeId.localeCompare(b.attributeId)).map((axis) => {
      const values = [...axis.values].sort();
      return { attributeId: axis.attributeId, name: axis.name, values, valueIds: values.map((value) => legacyValueId(axis.attributeId, value)), createsVariants: true };
    }));
  } catch { requiresReview = true; }
  if (!attributes.length) requiresReview = true;
  const identities = new Map(input.identities?.map((identity) => [identity.productId, identity]) ?? []);
  const usedKeys = new Set<string>();
  const members = input.members.map((member, index) => {
    const specs = visibleSpecs[index];
    const selections: [string, string][] = [];
    for (const axis of attributes) {
      const spec = specs.find((entry) => entry.catalog?.id === axis.attributeId || variantNameKey(entry.name) === variantNameKey(axis.name));
      const valueIndex = spec?.values.length === 1 ? axis.values.indexOf(spec.values[0].trim()) : -1;
      if (valueIndex < 0) continue;
      selections.push([axis.attributeId, axis.valueIds[valueIndex]]);
    }
    const valid = attributes.length > 0 && selections.length === attributes.length && specs.length === attributes.length;
    const combinationKey = valid ? variantCombinationKey(selections) : undefined;
    const stored = identities.get(member.id);
    if (!valid || (combinationKey && usedKeys.has(combinationKey)) || (stored?.combinationKey && stored.combinationKey !== combinationKey)) requiresReview = true;
    if (combinationKey) usedKeys.add(combinationKey);
    return { ...member, combinationKey, optionValueIds: selections.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value) };
  });
  let excludedCombinationKeys = input.stored?.excludedCombinationKeys ?? [];
  try {
    // Sparse imported groups retain only their existing SKUs when first edited.
    excludedCombinationKeys = [...new Set([...excludedCombinationKeys, ...buildVariantCombinations(attributes, {
      maxCombinations: variantCombinationBudget(input.members.length, excludedCombinationKeys.length),
    })
      .filter((combo) => !usedKeys.has(combo.combinationKey)).map((combo) => combo.combinationKey)])];
  } catch { requiresReview = true; }
  const sameUnit = new Set(members.map((member) => member.baseUnit.trim().toLowerCase())).size <= 1;
  const prices = (key: "costPrice" | "retailPrice") => members.map((member) => Number(member[key]));
  return {
    id: input.id, name: input.name, kind: input.kind, attributes, members,
    excludedCombinationKeys, revision: input.stored?.revision ?? 0, requiresReview,
    count: members.length,
    totalStock: sameUnit ? String(members.reduce((sum, member) => sum + Number(member.totalStock), 0)) : null,
    minCostPrice: String(Math.min(...prices("costPrice"))), maxCostPrice: String(Math.max(...prices("costPrice"))),
    minRetailPrice: String(Math.min(...prices("retailPrice"))), maxRetailPrice: String(Math.max(...prices("retailPrice"))),
  };
}
