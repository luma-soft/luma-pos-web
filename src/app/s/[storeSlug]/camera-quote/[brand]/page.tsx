import { notFound } from "next/navigation";
import { CameraBrandPriceList } from "@/components/camera-quote/camera-brand-price-list";
import { getHikvisionQuoteProducts, HIKVISION_QUOTE_SKUS } from "@/lib/data/hikvision-quote";
import { resolvePublicStoreBySlug } from "@/lib/tenancy/public-store";
import { HikvisionQuoteClient } from "@/app/camera-quote/hikvision/hikvision-quote-client";

const brands = { ezviz: "EZVIZ", imou: "IMOU" } as const;

export default async function StoreBrandCameraQuotePage({ params }: { params: Promise<{ storeSlug: string; brand: string }> }) {
  const { storeSlug, brand } = await params;
  const store = await resolvePublicStoreBySlug(storeSlug, "camera_quote_builder");
  if (!store) notFound();

  if (brand === "hikvision") {
    const products = await getHikvisionQuoteProducts(store.id);
    return <main className="min-h-dvh bg-slate-100 px-4 py-8 sm:px-6 sm:py-12"><HikvisionQuoteClient backLabel="Quay lại" catalogReady={products.length === HIKVISION_QUOTE_SKUS.length} products={products} /></main>;
  }
  const brandName = brands[brand as keyof typeof brands];
  if (!brandName) notFound();
  return <CameraBrandPriceList brand={brandName} storeId={store.id} />;
}
