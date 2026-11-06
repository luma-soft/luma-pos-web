import { DEFAULT_PRODUCT_SORT, parseProductSort, PRODUCT_SORTS, type ProductSort } from "@/lib/product-sort-policy";

export const PRODUCT_LIST_SORTS = PRODUCT_SORTS;

export type ProductListSort = ProductSort;

export const DEFAULT_PRODUCT_LIST_SORT: ProductListSort = DEFAULT_PRODUCT_SORT;

export function parseProductListSort(value: unknown, fallback: ProductListSort = DEFAULT_PRODUCT_LIST_SORT): ProductListSort {
  return parseProductSort(value, fallback);
}
