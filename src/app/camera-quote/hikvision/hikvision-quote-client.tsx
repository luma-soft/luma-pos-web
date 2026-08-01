"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, CircleAlert, Database, Network, Server, ShieldCheck } from "lucide-react";
import type { HikvisionQuoteProduct } from "@/lib/data/hikvision-quote";
import { formatCurrency } from "@/lib/utils";

type SystemSize = "4" | "8";
type CameraQuality = "2mp" | "4mp";
type PoeMethod = "nvr" | "switch";
type StorageDays = "7" | "15" | "30";

const SKU = {
  camera: { "2mp": "HK-IP-DS2CD1023G2-LIUF", "4mp": "HK-IP-DS2CD1043G2-LIUF" },
  nvr: { "4": { nvr: "HK-NVR-DS7604NI-K1-4P", switch: "HK-NVR-DS7604NI-K1" }, "8": { nvr: "HK-NVR-DS7608NI-K1-8P", switch: "HK-NVR-DS7608NI-K1" } },
  switch: { "4": "HK-SW-DS3E0106P-EM", "8": "HK-SW-DS3E1310P-EIM" },
  storage: { "1": "SG-SKYHAWK-1TB", "2": "SG-SKYHAWK-2TB", "4": "SG-SKYHAWK-4TB" },
  materials: "MAT-HIK-IP-PER-CAMERA",
  installation: "SVC-HIK-IP-INSTALL-PER-CAMERA",
  ups: "UPS-HIK-650VA",
} as const;

function storageSize(size: SystemSize, quality: CameraQuality, days: StorageDays): "1" | "2" | "4" {
  const required = Number(size) * (quality === "4mp" ? 1.75 : 1) * Number(days);
  if (required <= 60) return "1";
  if (required <= 150) return "2";
  return "4";
}

export function HikvisionQuoteClient({ backLabel, catalogReady, products }: { backLabel: string; catalogReady: boolean; products: HikvisionQuoteProduct[] }) {
  const t = useTranslations("cameraQuotePage.hikvision");
  const [systemSize, setSystemSize] = useState<SystemSize>("4");
  const [quality, setQuality] = useState<CameraQuality>("4mp");
  const [poeMethod, setPoeMethod] = useState<PoeMethod>("nvr");
  const [storageDays, setStorageDays] = useState<StorageDays>("15");
  const [includeUps, setIncludeUps] = useState(false);
  const bySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);
  const product = useCallback((sku: string) => bySku.get(sku), [bySku]);
  const selectedStorage = storageSize(systemSize, quality, storageDays);
  const cameraCount = Number(systemSize);
  const hasCatalogGap = !catalogReady;

  const lineItems = useMemo(() => {
    const fromProduct = (label: string, sku: string, quantity = 1) => {
      const item = product(sku);
      return { label, model: item?.name ?? sku, total: (item?.retailPrice ?? 0) * quantity, unavailable: !item };
    };
    const items = [
      fromProduct(t("items.camera", { count: cameraCount }), SKU.camera[quality], cameraCount),
      fromProduct(t("items.recorder"), SKU.nvr[systemSize][poeMethod]),
      fromProduct(t("items.storage"), SKU.storage[selectedStorage]),
      poeMethod === "switch"
        ? fromProduct(t("items.poeSwitch"), SKU.switch[systemSize])
        : { label: t("items.poeIntegrated"), model: product(SKU.nvr[systemSize].nvr)?.name ?? SKU.nvr[systemSize].nvr, total: 0, unavailable: false },
      fromProduct(t("items.materials"), SKU.materials, cameraCount),
      fromProduct(t("items.installation"), SKU.installation, cameraCount),
    ];
    if (includeUps) items.push(fromProduct(t("items.ups"), SKU.ups));
    return items;
  }, [cameraCount, includeUps, poeMethod, product, quality, selectedStorage, systemSize, t]);

  const hasUnavailableItem = lineItems.some((item) => item.unavailable);
  const total = lineItems.reduce((sum, item) => sum + item.total, 0);
  const optionClass = (selected: boolean) => `rounded-xl border px-3 py-3 text-left text-sm font-bold transition ${selected ? "border-[#078a82] bg-teal-50 text-[#06766f]" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"}`;

  return (
    <div className="mx-auto max-w-6xl overflow-hidden bg-white shadow-[0_18px_60px_rgba(15,23,42,.14)]">
      <div className="flex h-8 bg-[#12364f]"><div className="w-1/5 bg-[#078a82]" /></div>
      <div className="px-6 py-10 sm:px-10 sm:py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Image src="/brands/hikvision-logo.svg" alt="Hikvision logo" width={220} height={60} className="h-12 w-44 object-contain object-left" />
            <h1 className="mt-5 text-3xl font-black tracking-tight text-[#14344d] sm:text-4xl">{t("title")}</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{t("description")}</p>
          </div>
          <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-900 sm:max-w-xs"><ShieldCheck className="mb-1 h-5 w-5 text-[#078a82]" />{t("catalogNotice")}</div>
        </div>

        {hasCatalogGap && <div className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />{t("catalogMissing")}</div>}

        <section className="mt-9 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-base font-extrabold text-[#14344d]">{t("configure")}</h2>
            <fieldset className="mt-5"><legend className="text-sm font-bold text-slate-700">{t("cameraCount")}</legend><div className="mt-3 grid grid-cols-2 gap-3">{(["4", "8"] as SystemSize[]).map((size) => <button key={size} type="button" onClick={() => setSystemSize(size)} className={optionClass(systemSize === size)}>{t("cameras", { count: size })}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("cameraQuality")}</legend><div className="mt-3 grid grid-cols-2 gap-3">{(["2mp", "4mp"] as CameraQuality[]).map((value) => <button key={value} type="button" onClick={() => setQuality(value)} className={optionClass(quality === value)}>{t(`quality.${value}`)}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("storageDays")}</legend><div className="mt-3 grid grid-cols-3 gap-2">{(["7", "15", "30"] as StorageDays[]).map((days) => <button key={days} type="button" onClick={() => setStorageDays(days)} className={optionClass(storageDays === days)}>{t("days", { count: days })}</button>)}</div><p className="mt-2 text-xs leading-5 text-slate-500">{t("storageHint", { capacity: selectedStorage, count: cameraCount })}</p></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("poeMethod")}</legend><div className="mt-3 space-y-3">{(["nvr", "switch"] as PoeMethod[]).map((method) => <button key={method} type="button" onClick={() => setPoeMethod(method)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition ${poeMethod === method ? "border-[#078a82] bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300"}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${poeMethod === method ? "border-[#078a82] bg-[#078a82] text-white" : "border-slate-300"}`}>{poeMethod === method && <Check className="h-3.5 w-3.5" />}</span><span><span className="block font-bold text-[#14344d]">{t(`poe.${method}.title`)}</span><span className="mt-1 block leading-5 text-slate-500">{t(`poe.${method}.description`)}</span></span></button>)}</div></fieldset>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" checked={includeUps} onChange={(event) => setIncludeUps(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#078a82]" /><span><span className="block font-bold text-[#14344d]">{t("ups.title")}</span><span className="mt-1 block leading-5 text-slate-500">{t("ups.description")}</span></span></label>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex items-center gap-3 bg-[#12364f] px-5 py-4 text-white"><Server className="h-5 w-5" /><h2 className="font-extrabold">{t("summaryTitle")}</h2></div><div className="divide-y divide-slate-200">{lineItems.map((item) => <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-3.5"><div><p className="font-semibold text-[#14344d]">{item.label}</p><p className="mt-0.5 text-sm text-slate-500">{item.model}</p></div><p className={`self-center text-right font-bold tabular-nums ${item.unavailable ? "text-amber-700" : "text-[#14344d]"}`}>{item.unavailable ? t("unavailable") : item.total ? formatCurrency(item.total) : t("included")}</p></div>)}</div><div className="flex items-center justify-between gap-4 bg-teal-50 px-5 py-4"><div><p className="font-extrabold text-[#14344d]">{t("total")}</p><p className="mt-0.5 text-xs text-slate-500">{t("vatExcluded")}</p></div><p className="text-xl font-black tabular-nums text-[#078a82]">{hasUnavailableItem ? "—" : formatCurrency(total)}</p></div></section>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><Network className="h-5 w-5 text-[#078a82]" /><h2 className="mt-2 font-extrabold text-[#14344d]">{t("includedTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("includedDescription")}</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><Database className="h-5 w-5 text-amber-700" /><h2 className="mt-2 font-extrabold text-amber-900">{t("actualCostTitle")}</h2><p className="mt-1 text-sm leading-6 text-amber-900/80">{t("actualCostDescription")}</p></div></section>
        <Link href="/camera-quote" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]"><ArrowLeft className="h-4 w-4" /> {backLabel}</Link>
      </div>
    </div>
  );
}
