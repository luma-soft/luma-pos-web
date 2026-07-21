"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { issueEInvoice } from "@/lib/actions/einvoice";

export function EInvoiceForm({ orderId, defaultBuyer }: { orderId: string; defaultBuyer: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buyerName, setBuyerName] = useState(defaultBuyer);
  const [buyerTaxCode, setBuyerTaxCode] = useState("");
  const [vatRate, setVatRate] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!buyerName.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await issueEInvoice({
      orderId,
      buyerName,
      buyerTaxCode: buyerTaxCode || undefined,
      vatRate,
      requestId: `web-einvoice-${orderId}`,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-primary-600 hover:underline">
        + {t("einvoice.issue")}
      </button>
    );
  }

  const cls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{t("einvoice.cols.buyer")} *</label>
        <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={`${cls} w-48`} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">MST</label>
        <input value={buyerTaxCode} onChange={(e) => setBuyerTaxCode(e.target.value)} className={`${cls} w-32`} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">VAT %</label>
        <input type="number" min={0} max={20} value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} className={`${cls} w-20 text-right`} />
      </div>
      <button onClick={submit} disabled={busy || !buyerName.trim()}
        className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("einvoice.issue")}
      </button>
      {error && <p className="text-xs text-er w-full">{error}</p>}
    </div>
  );
}
