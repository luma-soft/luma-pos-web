"use client";
import { catalogTextByFlag, legacyTextByFlag } from "@/lib/i18n/catalog-text";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { completeOnboarding } from "@/lib/actions/onboarding";
import type { StoreSettings } from "@/lib/data/settings";
import { cn } from "@/lib/utils";

const INDUSTRY = [
  "grocery", "cafe", "restaurant", "fashion", "electronics", "cosmetics", "books", "services", "petshop", "mobile", "construction",
] as const;
const FI = "w-full px-3 py-2.5 text-sm rounded-[10px] border border-border bg-canvas focus:border-primary-500 focus:outline-none";
const FL = "text-[10px] font-bold uppercase tracking-wide text-slate-500";

export function OnboardingWizard({ initial }: { initial: StoreSettings }) {
  const locale = useLocale();
  const L = locale === "vi";
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: initial.name, phone: initial.phone, address: initial.address, industry: initial.industry || "grocery", currency: initial.currency || "VND", locale: initial.locale || "vi-VN" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const industryOpts = INDUSTRY.map((value) => ({ value, label: catalogTextByFlag(L, `settings.ui.industries.${value}`) }));
  const currencyOpts = [{ value: "VND", label: catalogTextByFlag(L, "settings.ui.currency.vnd") }, { value: "USD", label: catalogTextByFlag(L, "settings.ui.currency.usd") }];
  const localeOpts = [{ value: "vi-VN", label: catalogTextByFlag(L, "settings.ui.locale.vi") }, { value: "en-US", label: catalogTextByFlag(L, "settings.ui.locale.en") }];
  const steps = [legacyTextByFlag(L, "1906bd965255"), legacyTextByFlag(L, "52610dda06ad"), legacyTextByFlag(L, "3b10c36ecf1e")];

  function finish() {
    setErr("");
    start(async () => {
      const res = await completeOnboarding(f);
      if (res.ok) router.push("/dashboard");
      else setErr(res.error);
    });
  }

  return (
    <div className="w-full max-w-lg bg-surface border border-border rounded-card shadow-e2 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-xl grid place-items-center text-white font-extrabold bg-gradient-to-br from-primary-600 to-primary-400">H</div>
          <div className="font-bold text-lg">Hải Đăng</div>
        </div>
        <div className="text-xl font-extrabold">{legacyTextByFlag(L, "b1e156ded83e")}</div>
        <div className="text-xs text-slate-500 mt-0.5">{legacyTextByFlag(L, "c65f2dd0e89f")}</div>
        <div className="flex items-center gap-2 mt-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <span className={cn("w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0", i < step ? "bg-primary-600 text-white" : i === step ? "bg-primary-600 text-white" : "bg-surface-2 text-slate-400")}>{i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
              <span className={cn("text-[11px] font-semibold truncate", i === step ? "text-slate-900 dark:text-slate-100" : "text-slate-400")}>{s}</span>
              {i < steps.length - 1 && <span className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 flex flex-col gap-3">
        {step === 0 && <>
          <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "5a9af4186c49")}</span><input className={FI} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={legacyTextByFlag(L, "64c8a3e60d12")} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "8f0bb5fb2246")}</span><input className={FI} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "4c007f9511be")}</span><input className={FI} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
        </>}
        {step === 1 && <>
          <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "d251731ba879")}</span><SearchableSelect options={industryOpts} value={f.industry} onChange={(v) => set("industry", v)} allowClear={false} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "b5fc197ba6f4")}</span><SearchableSelect options={currencyOpts} value={f.currency} onChange={(v) => set("currency", v)} allowClear={false} /></div>
            <div className="flex flex-col gap-1"><span className={FL}>{legacyTextByFlag(L, "72f1efd68f11")}</span><SearchableSelect options={localeOpts} value={f.locale} onChange={(v) => set("locale", v)} allowClear={false} /></div>
          </div>
        </>}
        {step === 2 && <div className="flex flex-col gap-2 text-sm">
          <div className="text-xs text-slate-500">{legacyTextByFlag(L, "1938a79de90c")}</div>
          {[[legacyTextByFlag(L, "60f67a3547b1"), f.name || "—"], [legacyTextByFlag(L, "5745605d2af1"), f.phone || "—"], [legacyTextByFlag(L, "4c007f9511be"), f.address || "—"], [legacyTextByFlag(L, "d251731ba879"), industryOpts.find((o) => o.value === f.industry)?.label ?? f.industry], [legacyTextByFlag(L, "b5fc197ba6f4"), f.currency]].map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3 px-3 py-2 bg-canvas border border-border rounded-[10px]"><span className="text-slate-500">{k}</span><span className="font-semibold text-right truncate">{v}</span></div>
          ))}
        </div>}
        {err && <p className="text-xs text-er">{legacyTextByFlag(L, "96b1784b8f72")}</p>}
      </div>

      <div className="px-6 pb-6 flex items-center gap-2">
        {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-2"><ArrowLeft className="w-4 h-4" />{legacyTextByFlag(L, "0413ad1837ca")}</button>}
        <div className="flex-1" />
        {step < 2
          ? <button onClick={() => setStep((s) => s + 1)} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-5 text-sm font-semibold text-white">{legacyTextByFlag(L, "a0790bcea26e")}<ArrowRight className="w-4 h-4" /></button>
          : <button disabled={pending} onClick={finish} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{legacyTextByFlag(L, "fd7821478c99")}</button>}
      </div>
    </div>
  );
}
