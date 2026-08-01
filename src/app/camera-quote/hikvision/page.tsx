import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getHikvisionQuoteProducts, HIKVISION_QUOTE_SKUS } from "@/lib/data/hikvision-quote";
import { HikvisionQuoteClient } from "./hikvision-quote-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  const title = `${t("cameraQuotePage.hikvision.title")} | Hải Đăng Tech`;
  const description = t("cameraQuotePage.hikvision.metaDescription");
  return { title, description, openGraph: { title, description, type: "website" } };
}

export default async function HikvisionCameraQuotePage() {
  const t = await getTranslations();
  const products = await getHikvisionQuoteProducts();
  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <HikvisionQuoteClient backLabel={t("cameraQuotePage.hikvision.back")} catalogReady={products.length === HIKVISION_QUOTE_SKUS.length} products={products} />
    </main>
  );
}
