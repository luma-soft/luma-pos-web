import { and, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { productUnits } from "@/db/schema";
import { normalizeSearch, searchTokens } from "./normalize";

export { normalizeSearch };

// Bảng đổi ký tự tiếng Việt có dấu → không dấu (dùng translate() — không cần
// extension unaccent). Ghép theo nhóm để from/to luôn khớp độ dài.
const _A = "áàảãạăắằẳẵặâấầẩẫậ";
const _E = "éèẻẽẹêếềểễệ";
const _I = "íìỉĩị";
const _O = "óòỏõọôốồổỗộơớờởỡợ";
const _U = "úùủũụưứừửữự";
const _Y = "ýỳỷỹỵ";
const VN_FROM = _A + _E + _I + _O + _U + _Y + "đ";
const VN_TO =
  "a".repeat([..._A].length) +
  "e".repeat([..._E].length) +
  "i".repeat([..._I].length) +
  "o".repeat([..._O].length) +
  "u".repeat([..._U].length) +
  "y".repeat([..._Y].length) +
  "d";

/**
 * Điều kiện LIKE không phân biệt hoa/thường và không dấu cho 1 cột.
 * Cột được lower() rồi translate() bỏ dấu; pattern lấy từ normalizeSearch.
 */
export function accentInsensitiveLike(col: AnyColumn | SQL, q: string): SQL {
  const pattern = `%${normalizeSearch(q)}%`;
  return sql`translate(lower(${col}), ${VN_FROM}, ${VN_TO}) like ${pattern}`;
}

const COMBINING_MARKS = Array.from({ length: 0x70 }, (_, index) => String.fromCharCode(0x300 + index)).join("");

/** AND keywords across a product's fields; each keyword may match any field. */
export function productSearchCondition(columns: readonly (AnyColumn | SQL)[], query: string): SQL {
  const tokens = searchTokens(query);
  if (!tokens.length) return sql`false`;
  // translate also removes decomposed Vietnamese combining marks from stored text.
  const folded = columns.map((column) => sql`translate(lower(${column}), ${VN_FROM + COMBINING_MARKS}, ${VN_TO})`);
  return and(...tokens.map((token) => or(...folded.map((column) =>
    sql`${column} like ${`%${token}%`}`,
  ))!))!;
}

/** Inventory list search: all query terms must occur in one searchable field. */
export function productSearchWithinOneFieldCondition(columns: readonly (AnyColumn | SQL)[], query: string): SQL {
  const tokens = searchTokens(query);
  if (!tokens.length) return sql`false`;
  const folded = columns.map((column) => sql`translate(lower(${column}), ${VN_FROM + COMBINING_MARKS}, ${VN_TO})`);
  return or(...folded.map((field) => and(...tokens.map((token) =>
    sql`${field} like ${`%${token}%`}`,
  ))!))!;
}

type ProductSearchFields = {
  id: AnyColumn | SQL;
  storeId: AnyColumn | SQL;
  name: AnyColumn | SQL;
  sku: AnyColumn | SQL;
  barcode: AnyColumn | SQL;
  baseUnit: AnyColumn | SQL;
  variantName: AnyColumn | SQL;
  specs: AnyColumn | SQL;
};

/** Canonical product lookup fields used by POS and every product picker/list. */
export function catalogProductSearchCondition(
  fields: ProductSearchFields,
  query: string,
  extraColumns: readonly (AnyColumn | SQL)[] = [],
): SQL {
  const unitIdentifiers = sql<string | null>`(
    select string_agg(concat_ws(' ', ${productUnits.unitName}, ${productUnits.sku}, ${productUnits.barcode}), ' ')
    from ${productUnits}
    where ${productUnits.productId} = ${fields.id}
      and ${productUnits.storeId} = ${fields.storeId}
  )`;
  return productSearchCondition([
    fields.name,
    fields.sku,
    fields.barcode,
    fields.baseUnit,
    unitIdentifiers,
    fields.variantName,
    sql`${fields.specs}::text`,
    ...extraColumns,
  ], query);
}

/** POS lookup split into indexed product and unit candidate sets. */
export function posProductSearchCondition(
  fields: ProductSearchFields,
  query: string,
  storeId: string,
): SQL {
  const tokens = searchTokens(query);
  if (!tokens.length) return sql`false`;

  const directFields = [
    sql`pos_search_product.name`,
    sql`pos_search_product.sku`,
    sql`pos_search_product.barcode`,
    sql`pos_search_product.base_unit`,
    sql`pos_search_product.variant_name`,
    sql`pos_search_product.specs::text`,
  ].map((column) => sql`normalize_vietnamese_search_text(${column})`);
  const unitFields = [
    sql`normalize_vietnamese_search_text(pos_search_unit.unit_name)`,
    sql`normalize_vietnamese_search_text(pos_search_unit.sku)`,
    sql`normalize_vietnamese_search_text(pos_search_unit.barcode)`,
  ];
  const tokenCandidates = tokens.map((token) => {
    const pattern = `%${token}%`;
    const directMatches = or(...directFields.map((field) => sql`${field} like ${pattern}`))!;
    const unitMatches = or(...unitFields.map((field) => sql`${field} like ${pattern}`))!;
    const directCandidates = sql`
      select pos_search_product.id as product_id
      from products pos_search_product
      where pos_search_product.store_id = ${storeId}
        and ${directMatches}
    `;
    const unitCandidates = sql`
      select pos_search_unit.product_id as product_id
      from product_units pos_search_unit
      where pos_search_unit.store_id = ${storeId}
        and ${unitMatches}
    `;
    return sql`(${directCandidates} union ${unitCandidates})`;
  });
  const candidates = tokenCandidates.length === 1
    ? tokenCandidates[0]
    : sql`(${sql.join(tokenCandidates.map((candidate) => sql`(${candidate})`), sql` intersect `)})`;

  return sql`${fields.id} in (${candidates})`;
}

/**
 * Search the inventory catalog without combining a name fragment with a
 * coincidental number inside an SKU or barcode.
 */
export function inventoryProductSearchCondition(
  fields: ProductSearchFields,
  query: string,
): SQL {
  const unitIdentifiers = sql<string | null>`(
    select string_agg(concat_ws(' ', ${productUnits.unitName}, ${productUnits.sku}, ${productUnits.barcode}), ' ')
    from ${productUnits}
    where ${productUnits.productId} = ${fields.id}
      and ${productUnits.storeId} = ${fields.storeId}
  )`;
  const nameAndAttributes = sql`concat_ws(' ', ${sql.join([
    fields.name,
    fields.variantName,
    sql`${fields.specs}::text`,
  ], sql`, `)})`;

  return productSearchWithinOneFieldCondition([
    nameAndAttributes,
    fields.sku,
    fields.barcode,
    fields.baseUnit,
    unitIdentifiers,
  ], query);
}
