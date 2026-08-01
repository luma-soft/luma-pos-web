"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Network, Server, ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type SystemSize = "4" | "8";
type PoeMethod = "nvr" | "switch";

const packageData = {
  "4": {
    cameraCount: 4,
    cameraModel: "DS-2CD1043G2-LIU",
    cameraUnitPrice: 1_250_000,
    nvrIntegratedModel: "DS-7604NI-K1/4P",
    nvrIntegratedPrice: 2_150_000,
    nvrSwitchModel: "DS-7604NI-K1",
    nvrSwitchPrice: 1_360_000,
    switchModel: "DS-3E0105P-E",
    switchPrice: 715_000,
    hddModel: "SkyHawk 1TB",
    hddPrice: 1_300_000,
  },
  "8": {
    cameraCount: 8,
    cameraModel: "DS-2CD1043G2-LIU",
    cameraUnitPrice: 1_250_000,
    nvrIntegratedModel: "DS-7608NI-K1/8P",
    nvrIntegratedPrice: 2_600_000,
    nvrSwitchModel: "DS-7608NI-K1",
    nvrSwitchPrice: 2_000_000,
    switchModel: "DS-3E0109P-E",
    switchPrice: 1_290_000,
    hddModel: "SkyHawk 2TB",
    hddPrice: 1_850_000,
  },
} as const;

const materialPerCamera = 180_000;
const installationPerCamera = 250_000;

export function HikvisionQuoteClient({ backLabel }: { backLabel: string }) {
  const t = useTranslations("cameraQuotePage.hikvision");
  const [systemSize, setSystemSize] = useState<SystemSize>("4");
  const [poeMethod, setPoeMethod] = useState<PoeMethod>("nvr");
  const system = packageData[systemSize];

  const lineItems = useMemo(() => {
    const items = [
      { label: t("items.camera", { count: system.cameraCount }), model: system.cameraModel, total: system.cameraCount * system.cameraUnitPrice },
      {
        label: t("items.recorder"),
        model: poeMethod === "nvr" ? system.nvrIntegratedModel : system.nvrSwitchModel,
        total: poeMethod === "nvr" ? system.nvrIntegratedPrice : system.nvrSwitchPrice,
      },
      { label: t("items.storage"), model: system.hddModel, total: system.hddPrice },
      poeMethod === "switch"
        ? { label: t("items.poeSwitch"), model: system.switchModel, total: system.switchPrice }
        : { label: t("items.poeIntegrated"), model: system.nvrIntegratedModel, total: 0 },
      { label: t("items.materials"), model: t("items.perCamera", { count: system.cameraCount }), total: system.cameraCount * materialPerCamera },
      { label: t("items.installation"), model: t("items.perCamera", { count: system.cameraCount }), total: system.cameraCount * installationPerCamera },
    ];
    return items;
  }, [poeMethod, system, t]);

  const total = lineItems.reduce((sum, item) => sum + item.total, 0);

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
          <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-900 sm:max-w-xs">
            <ShieldCheck className="mb-1 h-5 w-5 text-[#078a82]" />
            {t("referenceNotice")}
          </div>
        </div>

        <section className="mt-9 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-base font-extrabold text-[#14344d]">{t("configure")}</h2>
            <fieldset className="mt-5">
              <legend className="text-sm font-bold text-slate-700">{t("cameraCount")}</legend>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(["4", "8"] as SystemSize[]).map((size) => (
                  <button key={size} type="button" onClick={() => setSystemSize(size)} className={`rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${systemSize === size ? "border-[#078a82] bg-teal-50 text-[#06766f]" : "border-slate-200 bg-white text-slate-700 hover:border-teal-300"}`}>
                    {t("cameras", { count: size })}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-6">
              <legend className="text-sm font-bold text-slate-700">{t("poeMethod")}</legend>
              <div className="mt-3 space-y-3">
                {(["nvr", "switch"] as PoeMethod[]).map((method) => (
                  <button key={method} type="button" onClick={() => setPoeMethod(method)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition ${poeMethod === method ? "border-[#078a82] bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300"}`}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${poeMethod === method ? "border-[#078a82] bg-[#078a82] text-white" : "border-slate-300"}`}>{poeMethod === method && <Check className="h-3.5 w-3.5" />}</span>
                    <span><span className="block font-bold text-[#14344d]">{t(`poe.${method}.title`)}</span><span className="mt-1 block leading-5 text-slate-500">{t(`poe.${method}.description`)}</span></span>
                  </button>
                ))}
              </div>
            </fieldset>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex items-center gap-3 bg-[#12364f] px-5 py-4 text-white"><Server className="h-5 w-5" /><h2 className="font-extrabold">{t("summaryTitle")}</h2></div>
            <div className="divide-y divide-slate-200">
              {lineItems.map((item) => <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-3.5"><div><p className="font-semibold text-[#14344d]">{item.label}</p><p className="mt-0.5 text-sm text-slate-500">{item.model}</p></div><p className="self-center text-right font-bold tabular-nums text-[#14344d]">{item.total ? formatCurrency(item.total) : t("included")}</p></div>)}
            </div>
            <div className="flex items-center justify-between gap-4 bg-teal-50 px-5 py-4"><div><p className="font-extrabold text-[#14344d]">{t("total")}</p><p className="mt-0.5 text-xs text-slate-500">{t("vatExcluded")}</p></div><p className="text-xl font-black tabular-nums text-[#078a82]">{formatCurrency(total)}</p></div>
          </section>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4"><Network className="h-5 w-5 text-[#078a82]" /><h2 className="mt-2 font-extrabold text-[#14344d]">{t("includedTitle")}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{t("includedDescription")}</p></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-extrabold text-amber-900">{t("actualCostTitle")}</h2><p className="mt-1 text-sm leading-6 text-amber-900/80">{t("actualCostDescription")}</p></div>
        </section>
        <Link href="/camera-quote" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#078a82]"><ArrowLeft className="h-4 w-4" /> {backLabel}</Link>
      </div>
    </div>
  );
}
