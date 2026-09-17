import type { PosProduct } from "@/lib/data/pos";
import { ProductSearchThumbnail } from "@/components/product-search/product-search-thumbnail";

/** Search-result thumbnail with an isolated, full-size image preview. */
export function PosProductThumbnail({ product }: { product: PosProduct }) {
  return <ProductSearchThumbnail product={product} />;
}
