import { notFound } from "next/navigation";
import { getPurchase, getPurchaseFormOptions, getPurchaseProductRowsByIds } from "@/lib/data/inventory";
import { PurchaseForm } from "./purchase-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic"; // không prerender (query DB lúc build → timeout)

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function csvUuids(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => UUID_RE.test(item))
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 100);
}

export default async function NewPurchasePage({ searchParams }: Props) {
  const context = await requireStoreContext();
  const sp = await searchParams;
  const productId = typeof sp.productId === "string" && UUID_RE.test(sp.productId) ? sp.productId : null;
  const productIds = csvUuids(sp.productIds);
  const createdProductId = typeof sp.createdProductId === "string" && UUID_RE.test(sp.createdProductId) ? sp.createdProductId : null;
  const copyFrom = typeof sp.copyFrom === "string" && UUID_RE.test(sp.copyFrom) ? sp.copyFrom : null;
  const aiPreview = sp.source === "ai-preview";
  const source = copyFrom ? await getPurchase(context.storeId, copyFrom).catch(() => null) : null;
  if (copyFrom && (!source || source.status === "cancelled" || source.status === "returned")) notFound();

  const seedProductIds = source?.items.map((i) => i.productId) ?? [
    ...productIds,
    ...(productId ? [productId] : []),
    ...(createdProductId ? [createdProductId] : []),
  ].filter((id, index, values) => values.indexOf(id) === index);
  const [options, initialProducts] = await Promise.all([
    getPurchaseFormOptions(context.storeId),
    seedProductIds.length > 0
      ? getPurchaseProductRowsByIds(context.storeId, seedProductIds, { includeInactive: Boolean(source) })
      : Promise.resolve([]),
  ]);
  const productsById = new Map(initialProducts.map((product) => [product.id, product]));
  const orderedInitialProducts = seedProductIds.flatMap((id) => {
    const product = productsById.get(id);
    return product ? [product] : [];
  });

  if (source) {
    return (
      <PurchaseForm
        canEditCompanyPrices={context.role === "owner" || context.role === "manager"}
        options={options}
        initialProducts={orderedInitialProducts}
        mode="copy"
        purchaseCode={source.code}
        initialValues={{
          supplierId: source.supplierId,
          warehouseId: source.warehouseId,
          discount: Number(source.discount),
          vatRate: Number(source.vatRate),
          shippingFee: Number(source.shippingFee),
          invoiceNumber: source.invoiceNumber ?? "",
          amountPaid: Number(source.amountPaid),
          note: source.note ?? "",
          items: source.items.map((i) => ({
            productId: i.productId,
            quantity: Number(i.quantity),
            unitCost: Number(i.unitCost),
            discount: Number(i.discount),
          })),
        }}
      />
    );
  }

  return <PurchaseForm options={options} initialProducts={orderedInitialProducts} createdProductId={createdProductId ?? undefined} aiPreview={aiPreview} canEditCompanyPrices={context.role === "owner" || context.role === "manager"} />;
}
