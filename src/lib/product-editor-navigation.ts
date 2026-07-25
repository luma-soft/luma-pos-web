import { Routes } from "@/lib/routes";

export function productEditorCloseHref(
  surface: "page" | "modal",
  productId: string,
) {
  return surface === "modal"
    ? Routes.productDetail(productId)
    : `${Routes.Inventory}?tab=products`;
}
