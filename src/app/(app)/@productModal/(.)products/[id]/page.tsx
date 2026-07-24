import { notFound } from "next/navigation";
import { ProductDetailDialog } from "@/components/product-detail-dialog";
import { getProductListItem } from "@/lib/data/products";
import { ProductDetailView } from "@/app/(app)/inventory/tabs/products-table";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailModalPage({ params }: Props) {
  const { id } = await params;
  const product = await getProductListItem(id);
  if (!product) notFound();

  return (
    <ProductDetailDialog title={product.name} subtitle={product.sku}>
      <ProductDetailView product={product} />
    </ProductDetailDialog>
  );
}
