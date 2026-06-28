import { notFound } from "next/navigation";
import { getPurchase, getPurchaseFormOptions, getPurchaseProductRowsByIds } from "@/lib/data/inventory";
import { PurchaseForm } from "./purchase-form";

export const dynamic = "force-dynamic"; // không prerender (query DB lúc build → timeout)

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function NewPurchasePage({ searchParams }: Props) {
  const sp = await searchParams;
  const productId = typeof sp.productId === "string" && UUID_RE.test(sp.productId) ? sp.productId : null;
  const copyFrom = typeof sp.copyFrom === "string" && UUID_RE.test(sp.copyFrom) ? sp.copyFrom : null;
  const source = copyFrom ? await getPurchase(copyFrom).catch(() => null) : null;
  if (copyFrom && (!source || source.status === "cancelled" || source.status === "returned")) notFound();

  const seedProductIds = source?.items.map((i) => i.productId) ?? (productId ? [productId] : []);
  const [options, initialProducts] = await Promise.all([
    getPurchaseFormOptions(),
    seedProductIds.length > 0 ? getPurchaseProductRowsByIds(seedProductIds) : Promise.resolve([]),
  ]);

  if (source) {
    return (
      <PurchaseForm
        options={options}
        initialProducts={initialProducts}
        mode="copy"
        purchaseCode={source.code}
        initialValues={{
          supplierId: source.supplierId,
          warehouseId: source.warehouseId,
          discount: Number(source.discount),
          vatRate: Number(source.vatRate),
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

  return <PurchaseForm options={options} initialProducts={initialProducts} />;
}
