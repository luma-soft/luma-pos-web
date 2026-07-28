"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Play } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { openShift, closeShift } from "@/lib/actions/shifts";
import { MoneyInput } from "@/components/ui/money-input";

export function ShiftPanel({ open, openingFloat, expected, openedAt }: {
  open: boolean; openingFloat?: number; expected?: number; openedAt?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [floatVal, setFloatVal] = useState("");
  const [counted, setCounted] = useState("");
  const [err, setErr] = useState("");

  const countedNum = Number(counted) || 0;
  const variance = open && expected != null ? countedNum - expected : 0;

  function doOpen() {
    setErr("");
    start(async () => {
      const res = await openShift(Number(floatVal) || 0);
      if (res.ok) { setFloatVal(""); router.refresh(); } else setErr(t(res.error as never));
    });
  }
  function doClose() {
    setErr("");
    start(async () => {
      const res = await closeShift(countedNum);
      if (res.ok) { setCounted(""); router.refresh(); } else setErr(t(res.error as never));
    });
  }

  if (!open) {
    return (
      <div className="bg-surface border border-border rounded-card shadow-e1 p-5 max-w-md mb-5">
        <div className="text-sm font-bold">{t("shifts.openTitle")}</div>
        <div className="text-xs text-slate-500 mt-0.5 mb-3">{t("shifts.openSub")}</div>
        <label className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{t("shifts.openFloat")}</label>
        <MoneyInput min={0} value={floatVal === "" ? null : Number(floatVal)} onChange={(value) => setFloatVal(value == null ? "" : String(value))} placeholder="0" className="mt-1 w-full rounded-[10px] bg-canvas font-mono" />
        {err && <p className="text-xs text-er mt-2">{err}</p>}
        <button disabled={pending} onClick={doOpen} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}{t("shifts.openBtn")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-card shadow-e1 p-5 max-w-md mb-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold">{t("shifts.current")}</div>
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-ok-soft text-ok">{t("shifts.status.open")}</span>
      </div>
      {openedAt && <div className="text-xs text-slate-400 mt-0.5">{t("shifts.openedAt")}: {openedAt}</div>}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="px-3 py-2.5 bg-canvas border border-border rounded-[10px]">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{t("shifts.openFloat")}</div>
          <div className="font-mono font-bold mt-0.5">{formatCurrency(openingFloat ?? 0)}</div>
        </div>
        <div className="px-3 py-2.5 bg-canvas border border-border rounded-[10px]">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{t("shifts.expected")}</div>
          <div className="font-mono font-bold mt-0.5 text-primary-600">{formatCurrency(expected ?? 0)}</div>
        </div>
      </div>
      <label className="block mt-3 text-[9px] font-bold uppercase tracking-wide text-slate-500">{t("shifts.counted")}</label>
      <MoneyInput min={0} value={counted === "" ? null : Number(counted)} onChange={(value) => setCounted(value == null ? "" : String(value))} placeholder="0" className="mt-1 w-full rounded-[10px] bg-canvas font-mono" />
      {counted !== "" && (
        <div className={cn("mt-2 text-sm font-semibold", variance === 0 ? "text-slate-500" : variance > 0 ? "text-ok" : "text-er")}>
          {t("shifts.variance")}: {variance > 0 ? "+" : ""}{formatCurrency(variance)} {variance === 0 ? `· ${t("shifts.exact")}` : variance > 0 ? `· ${t("shifts.over")}` : `· ${t("shifts.short")}`}
        </div>
      )}
      {err && <p className="text-xs text-er mt-2">{err}</p>}
      <button disabled={pending || counted === ""} onClick={doClose} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t("shifts.closeBtn")}
      </button>
    </div>
  );
}
