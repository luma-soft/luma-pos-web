export const PAGE_SIZES = [15, 30, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 30;

/** Ép số dòng/trang về một giá trị hợp lệ (từ query string). */
export function parsePageSize(v: string | undefined, fallback: number = DEFAULT_PAGE_SIZE): number {
  const n = Number(v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/** Ép số dòng/trang (number) về giá trị hợp lệ — dùng trong data layer. */
export function coercePageSize(n: number | undefined, fallback: number = DEFAULT_PAGE_SIZE): number {
  return n != null && (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}
