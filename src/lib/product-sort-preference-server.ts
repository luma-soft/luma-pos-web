import { cookies } from "next/headers";
import { DEFAULT_PRODUCT_SORT, parseProductSort, productSortPreferenceCookieName, type ProductSort } from "@/lib/product-sort-policy";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";

export async function getProductSortPreference(storeId: string, role?: string): Promise<ProductSort> {
  const cookieStore = await cookies();
  const sort = parseProductSort(cookieStore.get(productSortPreferenceCookieName(storeId))?.value, DEFAULT_PRODUCT_SORT);
  return sort === "cost" && !canViewPurchasePrices(role) ? DEFAULT_PRODUCT_SORT : sort;
}
