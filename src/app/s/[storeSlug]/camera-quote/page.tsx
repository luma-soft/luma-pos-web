import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { resolvePublicStoreBySlug } from "@/lib/tenancy/public-store";

const brands = [
  { id: "ezviz", name: "EZVIZ", logo: "/brands/ezviz-logo.png" },
  { id: "imou", name: "IMOU", logo: "/brands/imou-logo.svg" },
  { id: "hikvision", name: "Hikvision", logo: "/brands/hikvision-logo.svg" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ storeSlug: string }> }): Promise<Metadata> {
  const { storeSlug } = await params;
  const store = await resolvePublicStoreBySlug(storeSlug, "camera_quote_builder");
  return store ? { title: `Báo giá camera | ${store.name}`, description: `Chọn giải pháp camera từ ${store.name}.` } : {};
}

export default async function StoreCameraQuotePage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  const store = await resolvePublicStoreBySlug(storeSlug, "camera_quote_builder");
  if (!store) notFound();
  const basePath = `/s/${store.slug}/camera-quote`;

  return (
    <main className="min-h-dvh bg-slate-100 px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl overflow-hidden bg-white shadow-[0_18px_60px_rgba(15,23,42,.14)]">
        <div className="flex h-8 bg-[#12364f]"><div className="w-1/5 bg-[#078a82]" /></div>
        <div className="px-6 py-10 sm:px-12 sm:py-14">
          <p className="text-sm font-black tracking-[0.16em] text-[#078a82]">{store.name.toLocaleUpperCase("vi")}</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-[#14344d] sm:text-5xl">Báo giá camera</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">Chọn thương hiệu để xem cấu hình và giá lắp đặt phù hợp.</p>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {brands.map((brand) => (
              <Link key={brand.id} href={`${basePath}/${brand.id}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg">
                <div className="flex h-14 items-center"><Image src={brand.logo} alt={`${brand.name} logo`} width={180} height={56} className="h-12 w-36 object-contain object-left" /></div>
                <h2 className="mt-3 text-lg font-black text-[#14344d]">{brand.name}</h2>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]">Xem báo giá <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
