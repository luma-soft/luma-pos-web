import { ProductRecordLink } from "@/components/product-record-link";
import { isDeletedProductName } from "@/lib/products/deleted-product";

export function OrderProductLink({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  return (
    <ProductRecordLink
      productId={productId}
      deleted={isDeletedProductName(productName)}
      className="inline-flex min-h-11 min-w-11 items-center font-medium lg:min-h-0 lg:min-w-0"
      linkClassName="text-primary-600 hover:underline"
    >
      {productName}
    </ProductRecordLink>
  );
}
