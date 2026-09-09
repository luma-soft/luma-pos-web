import { Routes } from "@/lib/routes";

export function productEditorCloseHref(
  productId: string,
) {
  return Routes.productDetail(productId);
}
