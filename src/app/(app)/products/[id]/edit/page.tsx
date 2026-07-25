import { notFound } from "next/navigation";
import { getProduct, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { NewProductForm } from "../../new/product-form";
import { productToFormInitialValues } from "../../product-form-values";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const [product, options, priceBooks, priceOverridesByBook] = await Promise.all([
    getProduct(id),
    getProductFormOptions(),
    getPriceBooks(),
    getPriceOverridesForProducts([id]),
  ]);
  if (!product) notFound();
  const priceBookPrices = Object.fromEntries(
    Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[id]])
  );

  return (
    <NewProductForm
      mode="edit"
      productId={id}
      isVariantChild={Boolean(product.parentProductId)}
      siblingCount={product.siblings.length}
      initialValues={productToFormInitialValues(product, "edit", priceBookPrices)}
      categories={options.categories}
      brands={options.brands}
      suppliers={options.suppliers}
      comboProducts={options.comboProducts}
      priceBooks={priceBooks}
      aiPreview={sp.source === "ai-preview"}
      creationKind={product.productKind}
      currentStock={Number(product.totalStock)}
    />
  );
}
