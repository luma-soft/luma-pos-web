import { and, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
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
