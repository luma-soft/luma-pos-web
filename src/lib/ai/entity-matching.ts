import { normalizeSearch } from "@/lib/search";

const SKU_TOKEN_RE = /\b(?=[A-Z0-9._-]*[A-Z])(?=[A-Z0-9._-]*\d)[A-Z0-9]+(?:[._-][A-Z0-9]+)*\b/gi;

const SEARCH_STOPWORDS = new Set([
  "anh", "ban", "bang", "cap", "cho", "chuyen", "con", "cong", "cua", "dang",
  "den", "duoc", "gia", "hang", "hoa", "kho", "khong", "lai", "loai", "moi",
  "mot", "mua", "nhap", "nha", "phieu", "san", "sang", "sua", "tao", "theo",
  "thong", "them", "trong", "tu", "voi",
]);

export type AiProductCandidate = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  baseUnit: string;
  costPrice: unknown;
  lastPurchasePrice: unknown;
  retailPrice: unknown;
  categoryId: string | null;
  brandId: string | null;
  minStock: unknown;
  units: Array<{ unitName: string; multiplier: number }>;
  supplierSkus: string[];
};

export type AiInboundProductLookup = {
  text: string;
  sku?: string | null;
  confidence: number;
};

export type AiInboundProductMatch = {
  product: AiProductCandidate | null;
  confidence: number;
  ambiguous: AiProductCandidate[];
  matchedBy: "internal_sku" | "supplier_sku" | "name" | null;
};

function normalized(value: string) {
  return normalizeSearch(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function skuKey(value: string) {
  return value.trim().toUpperCase();
}

export function aiSupplierSkuTokens(values: readonly string[]) {
  return [...new Set(values.flatMap((value) => value.match(SKU_TOKEN_RE) ?? []).map(skuKey))];
}

export function aiEntitySearchTerms(values: readonly string[]) {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const key = normalized(term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    terms.push(term.trim());
  };

  for (const sku of aiSupplierSkuTokens(values)) add(sku);
  for (const value of values) {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact && compact.length <= 100) add(compact);
    for (const token of normalized(value).split(/\s+/)) {
      if (!token || SEARCH_STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
      if (token.length < 3 && !/\d/.test(token)) continue;
      add(token);
    }
  }
  return terms.slice(0, 32);
}

export function resolveAiProductUnit(
  product: { baseUnit: string; units: Array<{ unitName: string; multiplier: unknown }> } | null,
  sourceUnitName?: string | null,
) {
  if (!product) return { unitName: sourceUnitName ?? "", multiplier: 1 };
  if (sourceUnitName && normalized(product.baseUnit) === normalized(sourceUnitName)) {
    return { unitName: product.baseUnit, multiplier: 1 };
  }
  const alternate = sourceUnitName
    ? product.units.find((unit) => normalized(unit.unitName) === normalized(sourceUnitName))
    : null;
  return alternate
    ? { unitName: alternate.unitName, multiplier: Number(alternate.multiplier) || 1 }
    : { unitName: product.baseUnit, multiplier: 1 };
}

function productTokens(value: string) {
  return normalized(value).split(/\s+/).filter((token) => token.length > 1 || /\d/.test(token));
}

function modelTokens(value: string) {
  return new Set(productTokens(value).filter((token) => /[a-z]/.test(token) && /\d/.test(token)));
}

export function aiProductNameSimilarity(query: string, productName: string) {
  const queryText = normalized(query);
  const productText = normalized(productName);
  if (!queryText || !productText) return 0;
  if (queryText.includes(productText) || productText.includes(queryText)) return 0.94;

  const querySet = new Set(productTokens(query));
  const productSet = new Set(productTokens(productName));
  const overlap = [...productSet].filter((token) => querySet.has(token)).length;
  if (overlap < 2) return 0;
  const precision = overlap / querySet.size;
  const recall = overlap / productSet.size;
  const f1 = (2 * precision * recall) / Math.max(precision + recall, Number.EPSILON);
  if (productSet.size < 5 && querySet.size > productSet.size * 2 && precision < 0.4) return 0;

  const queryModels = modelTokens(query);
  const productModels = modelTokens(productName);
  if (queryModels.size > 0 && productModels.size > 0 && ![...queryModels].some((token) => productModels.has(token))) {
    return 0;
  }
  const identityToken = (token: string) => !/^\d+(?:a|k|m|mm|mp|v|w)$/.test(token);
  const queryIdentity = [...queryModels].filter(identityToken);
  const identityMatches = queryIdentity.filter((token) => productModels.has(token)).length;
  const identityCoverage = queryIdentity.length ? identityMatches / queryIdentity.length : 0;
  const coverageScore = recall * 0.7 + precision * 0.3 + identityCoverage * 0.12;
  if (overlap >= 3 && recall >= 0.55 && coverageScore >= 0.58) {
    return Math.min(0.93, 0.55 + coverageScore * 0.4);
  }
  return f1 >= 0.55 ? Math.min(0.93, 0.52 + f1 * 0.42) : 0;
}

export function matchAiInboundProduct(
  row: AiInboundProductLookup,
  candidates: AiProductCandidate[],
): AiInboundProductMatch {
  const requestedSku = row.sku ? skuKey(row.sku) : "";
  if (requestedSku) {
    const internal = candidates.find((product) => skuKey(product.sku) === requestedSku || skuKey(product.barcode ?? "") === requestedSku);
    if (internal) return { product: internal, confidence: Math.max(row.confidence, 0.98), ambiguous: [], matchedBy: "internal_sku" };
    const supplierMatches = candidates.filter((product) => product.supplierSkus.some((sku) => skuKey(sku) === requestedSku));
    if (supplierMatches.length === 1) {
      return { product: supplierMatches[0], confidence: Math.max(row.confidence, 0.97), ambiguous: [], matchedBy: "supplier_sku" };
    }
    if (supplierMatches.length > 1) {
      return { product: null, confidence: 0.45, ambiguous: supplierMatches.slice(0, 5), matchedBy: null };
    }
  }

  const scored = candidates
    .map((product) => ({ product, score: aiProductNameSimilarity(row.text, product.name) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  if (!top) return { product: null, confidence: row.confidence, ambiguous: [], matchedBy: null };
  if (second && top.score - second.score < 0.04) {
    return { product: null, confidence: Math.min(row.confidence, 0.55), ambiguous: scored.slice(0, 5).map((item) => item.product), matchedBy: null };
  }
  return {
    product: top.product,
    confidence: Math.min(Math.max(row.confidence, 0.78), top.score),
    ambiguous: [],
    matchedBy: "name",
  };
}
