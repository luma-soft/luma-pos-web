import { notFound } from "next/navigation";
import { getProduct, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { NewProductForm } from "../../new/product-form";
import { productToFormInitialValues } from "../../product-form-values";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const context = await requireStoreContext();
  const [product, options, priceBooks, priceOverridesByBook] = await Promise.all([
    getProduct(context.storeId, id),
    getProductFormOptions(context.storeId),
    getPriceBooks(context.storeId),
    getPriceOverridesForProducts(context.storeId, [id]),
  ]);
  if (!product) notFound();
  const priceBookPrices = Object.fromEntries(
    Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[id]])
  );

  return (
    <NewProductForm
      storeId={context.storeId}
      mode="edit"
      productId={id}
      isVariantChild={Boolean(product.parentProductId)}
      siblingCount={product.siblings.length}
      initialValues={productToFormInitialValues(product, "edit", priceBookPrices)}
      initialManagedImages={product.imageMedia}
      categories={options.categories}
      brands={options.brands}
      suppliers={options.suppliers}
      comboProducts={options.comboProducts}
      priceBooks={priceBooks}
      aiPreview={sp.source === "ai-preview"}
      creationKind={product.productKind}
    />
  );
}
