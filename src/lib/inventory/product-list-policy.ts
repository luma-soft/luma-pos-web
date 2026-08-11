export const PRODUCT_LIST_SORTS = ["name", "stock", "updated"] as const;

export type ProductListSort = (typeof PRODUCT_LIST_SORTS)[number];

export const DEFAULT_PRODUCT_LIST_SORT: ProductListSort = "updated";

export function parseProductListSort(value: unknown): ProductListSort {
  return PRODUCT_LIST_SORTS.includes(value as ProductListSort)
    ? (value as ProductListSort)
    : DEFAULT_PRODUCT_LIST_SORT;
}
