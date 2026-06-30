"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { Pencil, Loader2, X } from "lucide-react";
import { updateCustomer } from "@/lib/actions/partners";

type CustomerType = "retail" | "wholesale" | "contractor" | "agent";

export function CustomerEdit({ customer }: {
  customer: {
    id: string; name: string; phone: string | null; email: string | null;
    address: string | null; type: CustomerType; taxCode: string | null;
    debtLimit: string | null; note: string | null;
  };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [type, setType] = useState<CustomerType>(customer.type);
  const [taxCode, setTaxCode] = useState(customer.taxCode ?? "");
  const [debtLimit, setDebtLimit] = useState(String(Number(customer.debtLimit ?? 0)));
  const [note, setNote] = useState(customer.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    const res = await updateCustomer({
      id: customer.id, name: name.trim(), phone, email, address, type,
      taxCode, debtLimit: Number(debtLimit) || 0, note,
    });
    setSaving(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else setError(t(res.error));
  }

  const input = "w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  const lbl = "text-xs font-medium text-slate-500 mb-1 block";

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-2">
        <Pencil className="w-4 h-4" />{t("common.edit")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-surface rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold">{t("customers.editTitle")}</h2>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={lbl}>{t("customers.fields.name")}</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><label className={lbl}>{t("customers.cols.phone")}</label><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><label className={lbl}>Email</label><input className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={lbl}>{t("customers.fields.address")}</label><input className={input} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div><label className={lbl}>{t("customers.cols.type")}</label>
                <Select
                  className={input}
                  value={type}
                  onChange={(e) => setType(e.target.value as CustomerType)}
                  options={(["retail", "wholesale", "contractor", "agent"] as CustomerType[]).map((ty) => ({ value: ty, label: t(`customers.types.${ty}`) }))}
                />
              </div>
              <div><label className={lbl}>{t("customers.fields.taxCode")}</label><input className={input} value={taxCode} onChange={(e) => setTaxCode(e.target.value)} /></div>
              <div><label className={lbl}>{t("customers.fields.debtLimit")}</label><MoneyInput className={`no-spinner text-right ${input}`} value={debtLimit} onChange={(v) => setDebtLimit(String(v ?? 0))} /></div>
              <div className="sm:col-span-2"><label className={lbl}>{t("customers.fields.note")}</label><input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">{t("common.cancel")}</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}{t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
