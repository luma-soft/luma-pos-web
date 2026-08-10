import { notFound } from "next/navigation";
import { ProductDetailDialog } from "@/components/product-detail-dialog";
import { getProductListItem } from "@/lib/data/products";
import { ProductDetailView } from "@/app/(app)/inventory/tabs/products-table";
import { ProductEditorModal } from "@/app/(app)/inventory/tabs/products";
import { productEditorCloseHref } from "@/lib/product-editor-navigation";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ProductDetailModalPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requireStoreContext();
  const product = await getProductListItem(context.storeId, id);
  if (!product) notFound();

  return (
    <>
      <ProductDetailDialog title={product.name} subtitle={product.sku}>
        <ProductDetailView product={product} />
      </ProductDetailDialog>
      {query.edit === "1" && (
        <ProductEditorModal
          searchParams={{ productModal: "edit", productId: id }}
          closeHrefOverride={productEditorCloseHref("modal", id)}
          closeNavigation="replace"
        />
      )}
    </>
  );
}
