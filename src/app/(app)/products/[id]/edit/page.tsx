import { notFound } from "next/navigation";
import { getProduct, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { NewProductForm } from "../../new/product-form";
import { productToFormInitialValues, resolveProductFormSeed } from "../../product-form-values";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPublicMediaConfig } from "@/lib/media/config";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const context = await requireStoreContext();
  const publicMedia = getPublicMediaConfig();
  const [requestedProduct, options, priceBooks] = await Promise.all([
    getProduct(context.storeId, id),
    getProductFormOptions(context.storeId),
    getPriceBooks(context.storeId),
  ]);
  if (!requestedProduct) notFound();
  const seedMode = sp.groupEdit === "1" ? "groupEdit" : "edit";
  const product = await resolveProductFormSeed(requestedProduct, seedMode, (productId) => getProduct(context.storeId, productId));
  if (!product) notFound();
  const priceOverridesByBook = await getPriceOverridesForProducts(context.storeId, [product.id]);
  const priceBookPrices = Object.fromEntries(
    Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[product.id]])
  );

  return (
    <NewProductForm
      storeId={context.storeId}
      publicMediaBaseUrl={publicMedia.publicBaseUrl}
      mode="edit"
      productId={product.id}
      isVariantChild={Boolean(product.parentProductId)}
      siblingCount={product.siblings.length}
      initialValues={productToFormInitialValues(product, seedMode, priceBookPrices, publicMedia)}
      variantGroup={product.variantGroup}
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
