"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { createSupplier } from "@/lib/actions/partners";

export function SupplierQuickCreate() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createSupplier({ name, phone: phone || undefined, taxCode: taxCode || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setName(""); setPhone(""); setTaxCode("");
      router.refresh();
    } else {
      setError(t(res.error as never));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
      >
        <Plus className="w-4 h-4" />
        {t("suppliers.createNew")}
      </button>
    );
  }

  return (
    <div className="flex items-end gap-2 bg-surface border border-border rounded-card p-3">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{t("suppliers.cols.name")} *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-48 px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{t("customers.cols.phone")}</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-36 px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">{t("customers.fields.taxCode")}</label>
        <input value={taxCode} onChange={(e) => setTaxCode(e.target.value)} className="w-32 px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
      </div>
      <button onClick={submit} disabled={busy || !name.trim()} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("common.save")}
      </button>
      <button onClick={() => setOpen(false)} className="p-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
      {error && <p className="text-xs text-er">{error}</p>}
    </div>
  );
}
