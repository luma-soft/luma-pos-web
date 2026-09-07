/**
 * Chuẩn hoá chuỗi tìm kiếm: bỏ dấu, hạ chữ thường, đ→d, gộp khoảng trắng.
 * File này KHÔNG import drizzle nên an toàn dùng ở client (POS, form nhập hàng…).
 */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Product keywords can be separated by punctuation or other words. */
export function searchTokens(query: string): string[] {
  return [...new Set(normalizeSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

export function matchesSearchTokens(text: string, query: string): boolean {
  const normalized = normalizeSearch(text);
  const tokens = searchTokens(query);
  return (!query.trim() || tokens.length > 0) && tokens.every((token) => normalized.includes(token));
}
