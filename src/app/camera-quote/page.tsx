import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Camera, Network, Wifi } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  const title = `${t("cameraQuotePage.title")} | Hải Đăng Tech`;
  const description = t("cameraQuotePage.metaDescription");
  return { title, description, openGraph: { title, description, type: "website" } };
}

const brands = [
  {
    href: "/camera-quote/ezviz",
    name: "EZVIZ",
    Icon: Wifi,
    accent: "bg-teal-600",
  },
  {
    href: "/camera-quote/imou",
    name: "IMOU",
    Icon: Camera,
    accent: "bg-sky-600",
  },
  {
    href: "/camera-quote/hikvision",
    name: "Hikvision",
    Icon: Network,
    accent: "bg-indigo-600",
  },
];

export default async function CameraQuotePage() {
  const t = await getTranslations();
  return (
    <main className="min-h-full bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl overflow-hidden bg-white shadow-[0_18px_60px_rgba(15,23,42,.14)]">
        <div className="flex h-8 bg-[#12364f]"><div className="w-1/5 bg-[#078a82]" /></div>
        <div className="px-6 py-10 sm:px-12 sm:py-14">
          <p className="text-sm font-black tracking-[0.16em] text-[#078a82]">HẢI ĐĂNG TECH</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-[#14344d] sm:text-5xl">{t("cameraQuotePage.title")}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            {t("cameraQuotePage.intro")}
          </p>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {brands.map(({ href, name, Icon, accent }) => (
              <Link key={name} href={href} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg">
                <span className={`grid h-11 w-11 place-items-center rounded-xl text-white ${accent}`}><Icon className="h-5 w-5" /></span>
                <h2 className="mt-5 text-2xl font-black text-[#14344d]">{name}</h2>
                <p className="mt-2 min-h-12 text-sm leading-5 text-slate-600">{t(`cameraQuotePage.brands.${name.toLocaleLowerCase("en")}.description`)}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]">{t("cameraQuotePage.viewQuote")} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
