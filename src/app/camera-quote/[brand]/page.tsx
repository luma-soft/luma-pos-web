import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CameraBrandPriceList } from "@/components/camera-quote/camera-brand-price-list";

type Brand = "ezviz" | "imou";
const brands: Record<Brand, "EZVIZ" | "IMOU"> = { ezviz: "EZVIZ", imou: "IMOU" };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand } = await params;
  const brandName = brands[brand as Brand];
  if (!brandName) return {};
  const t = await getTranslations();
  const title = `${t("cameraQuotePage.brandPriceTitle", { brand: brandName })} | Hải Đăng Tech`;
  const description = t("cameraQuotePage.brandPriceDescription", { brand: brandName });
  return { title, description, openGraph: { title, description, type: "website" } };
}

export default async function BrandCameraQuotePage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  const brandName = brands[brand as Brand];
  if (!brandName) notFound();
  return <CameraBrandPriceList brand={brandName} />;
}
