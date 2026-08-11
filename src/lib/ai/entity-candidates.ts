import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { productSuppliers, productUnits, products } from "@/db/schema";
import {
  aiEntitySearchTerms,
  aiSupplierSkuTokens,
  type AiProductCandidate,
} from "@/lib/ai/entity-matching";
import { accentInsensitiveLike } from "@/lib/search";

export {
  aiEntitySearchTerms,
  matchAiInboundProduct,
  resolveAiProductUnit,
  type AiProductCandidate,
} from "@/lib/ai/entity-matching";

const AI_PRODUCT_CANDIDATE_LIMIT_PER_QUERY = 80;
const AI_PRODUCT_TERMS_PER_QUERY = 3;

const productSelection = {
  id: products.id,
  sku: products.sku,
  barcode: products.barcode,
  name: products.name,
  baseUnit: products.baseUnit,
  costPrice: products.costPrice,
  lastPurchasePrice: products.lastPurchasePrice,
  retailPrice: products.retailPrice,
  categoryId: products.categoryId,
  brandId: products.brandId,
  minStock: products.minStock,
};

function withProductDetails(
  rows: Array<Omit<AiProductCandidate, "supplierSkus" | "units">>,
  aliases: Array<{ productId: string; supplierSku: string | null }>,
  units: Array<{ productId: string; unitName: string; multiplier: unknown }>,
) {
  const aliasesByProduct = new Map<string, string[]>();
  for (const alias of aliases) {
    if (!alias.supplierSku) continue;
    const current = aliasesByProduct.get(alias.productId) ?? [];
    current.push(alias.supplierSku);
    aliasesByProduct.set(alias.productId, current);
  }
  const unitsByProduct = new Map<string, Array<{ unitName: string; multiplier: number }>>();
  for (const unit of units) {
    const current = unitsByProduct.get(unit.productId) ?? [];
    current.push({ unitName: unit.unitName, multiplier: Number(unit.multiplier) || 1 });
    unitsByProduct.set(unit.productId, current);
  }
  return rows.map((row) => ({
    ...row,
    units: unitsByProduct.get(row.id) ?? [],
    supplierSkus: aliasesByProduct.get(row.id) ?? [],
  }));
}

export async function getAiProductCandidates(storeId: string, values: readonly string[]) {
  const terms = aiEntitySearchTerms(values);
  const termGroups = Array.from(
    { length: Math.ceil(terms.length / AI_PRODUCT_TERMS_PER_QUERY) },
    (_, index) => terms.slice(
      index * AI_PRODUCT_TERMS_PER_QUERY,
      (index + 1) * AI_PRODUCT_TERMS_PER_QUERY,
    ),
  );
  if (termGroups.length === 0) return [];
  const exactSupplierSkus = aiSupplierSkuTokens(values);

  const [directGroups, supplierRows] = await Promise.all([
    Promise.all(termGroups.map((terms) => db
        .select(productSelection)
        .from(products)
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          or(...terms.flatMap((term) => [
            accentInsensitiveLike(products.name, term),
            accentInsensitiveLike(products.sku, term),
            accentInsensitiveLike(products.barcode, term),
          ])),
        ))
        .limit(AI_PRODUCT_CANDIDATE_LIMIT_PER_QUERY))),
    exactSupplierSkus.length
      ? db
          .select({ ...productSelection, supplierSku: productSuppliers.supplierSku })
          .from(productSuppliers)
          .innerJoin(products, and(
            eq(products.storeId, storeId),
            eq(products.id, productSuppliers.productId),
            eq(products.isActive, true),
          ))
          .where(and(
            eq(productSuppliers.storeId, storeId),
            or(...exactSupplierSkus.map((sku) => accentInsensitiveLike(productSuppliers.supplierSku, sku))),
          ))
          .limit(AI_PRODUCT_CANDIDATE_LIMIT_PER_QUERY)
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, Omit<AiProductCandidate, "supplierSkus" | "units">>();
  for (const row of [...directGroups.flat(), ...supplierRows]) byId.set(row.id, row);
  const ids = [...byId.keys()];
  const [aliases, units] = ids.length
    ? await Promise.all([
        db
          .select({ productId: productSuppliers.productId, supplierSku: productSuppliers.supplierSku })
          .from(productSuppliers)
          .where(and(
            eq(productSuppliers.storeId, storeId),
            inArray(productSuppliers.productId, ids),
          )),
        db
          .select({ productId: productUnits.productId, unitName: productUnits.unitName, multiplier: productUnits.multiplier })
          .from(productUnits)
          .where(and(
            eq(productUnits.storeId, storeId),
            inArray(productUnits.productId, ids),
          )),
      ])
    : [[], []];
  return withProductDetails([...byId.values()], aliases, units);
}
