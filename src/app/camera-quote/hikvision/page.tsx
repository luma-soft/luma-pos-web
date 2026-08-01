import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Network } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  const title = `${t("cameraQuotePage.hikvision.title")} | Hải Đăng Tech`;
  const description = t("cameraQuotePage.hikvision.metaDescription");
  return { title, description, openGraph: { title, description, type: "website" } };
}

export default async function HikvisionCameraQuotePage() {
  const t = await getTranslations();
  return (
    <main className="min-h-full bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl overflow-hidden bg-white shadow-[0_18px_60px_rgba(15,23,42,.14)]">
        <div className="flex h-8 bg-[#12364f]"><div className="w-1/5 bg-[#078a82]" /></div>
        <div className="px-6 py-10 sm:px-12 sm:py-14">
          <Network className="h-9 w-9 text-indigo-600" />
          <h1 className="mt-5 text-4xl font-black tracking-tight text-[#14344d]">{t("cameraQuotePage.hikvision.title")}</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            {t("cameraQuotePage.hikvision.description")}
          </p>
          <div className="mt-7 rounded-xl border border-indigo-100 bg-indigo-50 p-5 text-sm leading-6 text-slate-700">
            {t("cameraQuotePage.hikvision.status")}
          </div>
          <Link href="/camera-quote" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]"><ArrowLeft className="h-4 w-4" /> {t("cameraQuotePage.hikvision.back")}</Link>
        </div>
      </div>
    </main>
  );
}
