"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, CircleAlert, Copy, Database, Network, Server, ShieldCheck } from "lucide-react";
import type { HikvisionQuoteProduct } from "@/lib/data/hikvision-quote";
import { formatCurrency } from "@/lib/utils";

type SystemSize = "4" | "8" | "16";
type CameraType = "bullet2" | "bullet4" | "dome4" | "ptz4";
type PoeMethod = "nvr" | "switch";
type StorageDays = "7" | "15" | "30";

const SKU = {
  camera: { bullet2: "HK-IP-DS2CD1023G2-LIUF", bullet4: "HK-IP-DS2CD1043G2-LIUF", dome4: "HK-IP-DS2CD1143G2-LIUF", ptz4: "HK-PTZ-DS2DE2A404IW-DE3" },
  nvr: { "4": { nvr: "HK-NVR-DS7604NI-K1-4P", switch: "HK-NVR-DS7604NI-K1" }, "8": { nvr: "HK-NVR-DS7608NI-K1-8P", switch: "HK-NVR-DS7608NI-K1" }, "16": { nvr: "HK-NVR-DS7616NI-K2-16P", switch: "HK-NVR-DS7616NI-K1" } },
  switch: { "4": "HK-SW-DS3E0106P-EM", "8": "HK-SW-DS3E1310P-EIM", "16": "HK-SW-DS3E1518P-SI" },
  storage: { "1": "SG-SKYHAWK-1TB", "2": "SG-SKYHAWK-2TB", "4": "SG-SKYHAWK-4TB", "6": "SG-SKYHAWK-6TB" },
  materials: "MAT-HIK-IP-PER-CAMERA",
  installation: "SVC-HIK-IP-INSTALL-PER-CAMERA",
  ups: "UPS-HIK-650VA",
  cable: "504585",
  rack: "ACC-HIK-RACK-6U",
  monitor: "ACC-HIK-MONITOR-22",
  surge: "ACC-HIK-SURGE-PER-CAMERA",
} as const;

const POE_WATTS_PER_CAMERA: Record<CameraType, number> = { bullet2: 6.5, bullet4: 6.5, dome4: 6.5, ptz4: 12 };
const POE_BUDGET_WATTS: Record<PoeMethod, Record<SystemSize, number>> = {
  nvr: { "4": 36, "8": 75, "16": 200 },
  switch: { "4": 35, "8": 80, "16": 230 },
};

function canvasLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function storageSize(size: SystemSize, cameraType: CameraType, days: StorageDays): "1" | "2" | "4" | "6" {
  const multiplier = cameraType === "bullet2" ? 1 : cameraType === "ptz4" ? 3 : 1.75;
  const required = Number(size) * multiplier * Number(days);
  if (required <= 60) return "1";
  if (required <= 150) return "2";
  if (required <= 300) return "4";
  return "6";
}

export function HikvisionQuoteClient({ backLabel, catalogReady, products }: { backLabel: string; catalogReady: boolean; products: HikvisionQuoteProduct[] }) {
  const t = useTranslations("cameraQuotePage.hikvision");
  const [systemSize, setSystemSize] = useState<SystemSize>("4");
  const [cameraType, setCameraType] = useState<CameraType>("bullet4");
  const [poeMethod, setPoeMethod] = useState<PoeMethod>("nvr");
  const [storageDays, setStorageDays] = useState<StorageDays>("15");
  const [includeUps, setIncludeUps] = useState(false);
  const [includeRack, setIncludeRack] = useState(false);
  const [includeMonitor, setIncludeMonitor] = useState(false);
  const [includeSurge, setIncludeSurge] = useState(false);
  const [cableMeters, setCableMeters] = useState(60);
  const [notice, setNotice] = useState("");
  const bySku = useMemo(() => new Map(products.map((product) => [product.sku, product])), [products]);
  const product = useCallback((sku: string) => bySku.get(sku), [bySku]);
  const selectedStorage = storageSize(systemSize, cameraType, storageDays);
  const cameraCount = Number(systemSize);
  const hasCatalogGap = !catalogReady;
  const requiredPoeWatts = cameraCount * POE_WATTS_PER_CAMERA[cameraType];
  const poeBudgetWatts = POE_BUDGET_WATTS[poeMethod][systemSize];
  const poeCompatible = requiredPoeWatts <= poeBudgetWatts;
  const priceCheckedAt = products.find((item) => item.specs["Kiểm tra giá"]?.[0])?.specs["Kiểm tra giá"]?.[0];

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const lineItems = useMemo(() => {
    const fromProduct = (label: string, sku: string, quantity = 1) => {
      const item = product(sku);
      return { label, model: item?.name ?? sku, total: (item?.retailPrice ?? 0) * quantity, unavailable: !item };
    };
    const items = [
      fromProduct(t("items.camera", { count: cameraCount }), SKU.camera[cameraType], cameraCount),
      fromProduct(t("items.recorder"), SKU.nvr[systemSize][poeMethod]),
      fromProduct(t("items.storage"), SKU.storage[selectedStorage]),
      poeMethod === "switch"
        ? fromProduct(t("items.poeSwitch"), SKU.switch[systemSize])
        : { label: t("items.poeIntegrated"), model: product(SKU.nvr[systemSize].nvr)?.name ?? SKU.nvr[systemSize].nvr, total: 0, unavailable: false },
      fromProduct(t("items.materials"), SKU.materials, cameraCount),
      fromProduct(t("items.cable", { meters: cableMeters }), SKU.cable, cableMeters),
      fromProduct(t("items.installation"), SKU.installation, cameraCount),
    ];
    if (includeUps) items.push(fromProduct(t("items.ups"), SKU.ups));
    if (includeRack) items.push(fromProduct(t("items.rack"), SKU.rack));
    if (includeMonitor) items.push(fromProduct(t("items.monitor"), SKU.monitor));
    if (includeSurge) items.push(fromProduct(t("items.surge"), SKU.surge, cameraCount));
    return items;
  }, [cableMeters, cameraCount, cameraType, includeMonitor, includeRack, includeSurge, includeUps, poeMethod, product, selectedStorage, systemSize, t]);

  const hasUnavailableItem = lineItems.some((item) => item.unavailable);
  const total = lineItems.reduce((sum, item) => sum + item.total, 0);
  const optionClass = (selected: boolean) => `rounded-xl border px-3 py-3 text-left text-sm font-bold transition ${selected ? "border-[#078a82] bg-teal-50 text-[#06766f]" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"}`;

  async function copyQuoteImage() {
    if (hasUnavailableItem) return setNotice(t("copy.unavailable"));
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 1800;
    const context = canvas.getContext("2d");
    if (!context) return setNotice(t("copy.failed"));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#12364f";
    context.fillRect(0, 0, canvas.width, 36);
    context.fillStyle = "#078a82";
    context.fillRect(0, 0, 280, 36);
    context.fillStyle = "#078a82";
    context.font = "700 22px Arial";
    context.fillText(t("copy.company"), 70, 100);
    context.fillStyle = "#14344d";
    context.font = "800 42px Arial";
    context.fillText(t("copy.title"), 70, 165);
    context.font = "24px Arial";
    context.fillText(t("copy.configuration", { count: cameraCount, type: t(`cameraTypes.${cameraType}`) }), 70, 210);
    context.fillStyle = "#e6f3f3";
    context.fillRect(70, 255, 1260, 62);
    context.fillStyle = "#14344d";
    context.font = "700 23px Arial";
    context.fillText(t("copy.item"), 94, 294);
    context.textAlign = "right";
    context.fillText(t("copy.amount"), 1305, 294);
    context.textAlign = "left";
    let y = 317;
    lineItems.forEach((item) => {
      const modelLines = canvasLines(context, item.model, 900);
      const rowHeight = Math.max(76, 35 + modelLines.length * 24);
      context.fillStyle = "#ffffff";
      context.fillRect(70, y, 1260, rowHeight);
      context.strokeStyle = "#cbd5e1";
      context.lineWidth = 1;
      context.strokeRect(70, y, 1260, rowHeight);
      context.fillStyle = "#14344d";
      context.font = "700 21px Arial";
      context.fillText(item.label, 94, y + 29);
      context.fillStyle = "#64748b";
      context.font = "18px Arial";
      modelLines.forEach((line, index) => context.fillText(line, 94, y + 55 + index * 24));
      context.fillStyle = "#14344d";
      context.font = "700 22px Arial";
      context.textAlign = "right";
      context.fillText(item.total ? formatCurrency(item.total) : t("included"), 1305, y + rowHeight / 2 + 8);
      context.textAlign = "left";
      y += rowHeight;
    });
    context.fillStyle = "#dff1f0";
    context.fillRect(70, y, 1260, 72);
    context.fillStyle = "#14344d";
    context.font = "800 25px Arial";
    context.fillText(t("total"), 94, y + 44);
    context.fillStyle = "#078a82";
    context.font = "800 30px Arial";
    context.textAlign = "right";
    context.fillText(formatCurrency(total), 1305, y + 46);
    context.textAlign = "left";
    context.fillStyle = "#64748b";
    context.font = "17px Arial";
    const noteLines = canvasLines(context, t("copy.note"), 1260);
    noteLines.forEach((line, index) => context.fillText(line, 70, y + 108 + index * 24));
    context.fillText(t("copy.contact"), 70, y + 152 + noteLines.length * 24);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return setNotice(t("copy.failed"));
    const download = () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `bao-gia-hikvision-${cameraCount}-camera.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    };
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setNotice(t("copy.success", { count: cameraCount }));
      } catch {
        download();
        setNotice(t("copy.downloaded"));
      }
    } else {
      download();
      setNotice(t("copy.downloaded"));
    }
  }

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
          <div className="flex gap-3 sm:max-w-xs sm:flex-col"><button type="button" onClick={copyQuoteImage} className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-[#078a82] transition hover:bg-teal-50"><Copy className="h-4 w-4" />{t("copy.button")}</button><div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-900"><ShieldCheck className="mb-1 h-5 w-5 text-[#078a82]" />{t("catalogNotice")}</div></div>
        </div>

        {hasCatalogGap && <div className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />{t("catalogMissing")}</div>}

        <section className="mt-9 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-base font-extrabold text-[#14344d]">{t("configure")}</h2>
            <fieldset className="mt-5"><legend className="text-sm font-bold text-slate-700">{t("cameraCount")}</legend><div className="mt-3 grid grid-cols-3 gap-3">{(["4", "8", "16"] as SystemSize[]).map((size) => <button key={size} type="button" onClick={() => setSystemSize(size)} className={optionClass(systemSize === size)}>{t("cameras", { count: size })}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("cameraType")}</legend><div className="mt-3 grid grid-cols-2 gap-3">{(["bullet2", "bullet4", "dome4", "ptz4"] as CameraType[]).map((value) => <button key={value} type="button" onClick={() => setCameraType(value)} className={optionClass(cameraType === value)}>{t(`cameraTypes.${value}`)}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("storageDays")}</legend><div className="mt-3 grid grid-cols-3 gap-2">{(["7", "15", "30"] as StorageDays[]).map((days) => <button key={days} type="button" onClick={() => setStorageDays(days)} className={optionClass(storageDays === days)}>{t("days", { count: days })}</button>)}</div><p className="mt-2 text-xs leading-5 text-slate-500">{t("storageHint", { capacity: selectedStorage, count: cameraCount })}</p></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{t("poeMethod")}</legend><div className="mt-3 space-y-3">{(["nvr", "switch"] as PoeMethod[]).map((method) => <button key={method} type="button" onClick={() => setPoeMethod(method)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition ${poeMethod === method ? "border-[#078a82] bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300"}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${poeMethod === method ? "border-[#078a82] bg-[#078a82] text-white" : "border-slate-300"}`}>{poeMethod === method && <Check className="h-3.5 w-3.5" />}</span><span><span className="block font-bold text-[#14344d]">{t(`poe.${method}.title`)}</span><span className="mt-1 block leading-5 text-slate-500">{t(`poe.${method}.description`)}</span></span></button>)}</div></fieldset>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm"><input type="checkbox" checked={includeUps} onChange={(event) => setIncludeUps(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#078a82]" /><span><span className="block font-bold text-[#14344d]">{t("ups.title")}</span><span className="mt-1 block leading-5 text-slate-500">{t("ups.description")}</span></span></label>
            <label className="mt-4 block text-sm font-bold text-slate-700">{t("cableMeters")}<input type="number" min="0" value={cableMeters} onChange={(event) => setCableMeters(Math.max(0, Number(event.target.value) || 0))} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
            <div className="mt-4 grid gap-2"><label className="flex cursor-pointer gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeRack} onChange={(event) => setIncludeRack(event.target.checked)} className="accent-[#078a82]" />{t("accessories.rack")}</label><label className="flex cursor-pointer gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeMonitor} onChange={(event) => setIncludeMonitor(event.target.checked)} className="accent-[#078a82]" />{t("accessories.monitor")}</label><label className="flex cursor-pointer gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeSurge} onChange={(event) => setIncludeSurge(event.target.checked)} className="accent-[#078a82]" />{t("accessories.surge")}</label></div>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex items-center gap-3 bg-[#12364f] px-5 py-4 text-white"><Server className="h-5 w-5" /><h2 className="font-extrabold">{t("summaryTitle")}</h2></div><div className="divide-y divide-slate-200">{lineItems.map((item) => <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-3.5"><div><p className="font-semibold text-[#14344d]">{item.label}</p><p className="mt-0.5 text-sm text-slate-500">{item.model}</p></div><p className={`self-center text-right font-bold tabular-nums ${item.unavailable ? "text-amber-700" : "text-[#14344d]"}`}>{item.unavailable ? t("unavailable") : item.total ? formatCurrency(item.total) : t("included")}</p></div>)}</div><div className="flex items-center justify-between gap-4 bg-teal-50 px-5 py-4"><div><p className="font-extrabold text-[#14344d]">{t("total")}</p><p className="mt-0.5 text-xs text-slate-500">{t("vatExcluded")}</p></div><p className="text-xl font-black tabular-nums text-[#078a82]">{hasUnavailableItem ? "—" : formatCurrency(total)}</p></div></section>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><Network className="h-5 w-5 text-[#078a82]" /><h2 className="mt-2 font-extrabold text-[#14344d]">{t("includedTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("includedDescription")}</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><Database className="h-5 w-5 text-amber-700" /><h2 className="mt-2 font-extrabold text-amber-900">{t("actualCostTitle")}</h2><p className="mt-1 text-sm leading-6 text-amber-900/80">{t("actualCostDescription")}</p></div></section>
        <section className={`mt-4 rounded-xl border p-4 ${poeCompatible ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50"}`}><h2 className={`font-extrabold ${poeCompatible ? "text-teal-900" : "text-amber-900"}`}>{t("compatibility.title")}</h2><p className={`mt-1 text-sm leading-6 ${poeCompatible ? "text-teal-900/80" : "text-amber-900/80"}`}>{t(poeCompatible ? "compatibility.ok" : "compatibility.warning", { required: requiredPoeWatts, budget: poeBudgetWatts })}</p></section>
        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-extrabold text-[#14344d]">{t("commercial.title")}</h2><dl className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 sm:grid-cols-2"><div><dt className="font-bold text-slate-700">{t("commercial.vat.label")}</dt><dd>{t("commercial.vat.value")}</dd></div><div><dt className="font-bold text-slate-700">{t("commercial.warranty.label")}</dt><dd>{t("commercial.warranty.value")}</dd></div><div><dt className="font-bold text-slate-700">{t("commercial.validity.label")}</dt><dd>{t("commercial.validity.value")}</dd></div><div><dt className="font-bold text-slate-700">{t("commercial.leadTime.label")}</dt><dd>{t("commercial.leadTime.value")}</dd></div></dl><p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">{t("priceReference", { checkedAt: priceCheckedAt ?? t("priceReferencePending") })}</p></section>
        <Link href="/camera-quote" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]"><ArrowLeft className="h-4 w-4" /> {backLabel}</Link>
      </div>
      {notice && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#12364f] px-5 py-3 text-sm font-bold text-white shadow-xl" role="status">{notice}</div>}
    </div>
  );
}
