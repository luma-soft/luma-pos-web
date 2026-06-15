"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { updateSupplier } from "@/lib/actions/partners";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { SupplierDetail, getSupplierPurchases } from "@/lib/data/partners";

type Purchases = Awaited<ReturnType<typeof getSupplierPurchases>>;

export function SupplierDetailClient({ supplier, purchases }: { supplier: SupplierDetail; purchases: Purchases }) {
  const t = useTranslations();
  const router = useRouter();

  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [taxCode, setTaxCode] = useState(supplier.taxCode ?? "");
  const [note, setNote] = useState(supplier.note ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    const res = await updateSupplier({ id: supplier.id, name: name.trim(), phone, email, address, taxCode, note });
    setSaving(false);
    if (res.ok) { setSaved(true); router.refresh(); setTimeout(() => setSaved(false), 2500); }
    else setError(t(res.error));
  }

  const input = "w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  const lbl = "text-xs font-medium text-slate-500 mb-1 block";
  const debt = Number(supplier.currentDebt);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={Routes.Suppliers} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-[17px] font-bold truncate">{supplier.name}</h1>
            <p className="text-xs text-slate-400">{supplier.code}{debt > 0 ? ` · ${t("suppliers.cols.debt")}: ` : ""}<span className="text-warn">{debt > 0 ? formatCurrency(debt) : ""}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-sm text-ok inline-flex items-center gap-1"><Check className="w-4 h-4" />{t("common.saved")}</span>}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{t("common.save")}
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-5">
        {error && <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-4 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>}

        <section className="bg-surface border border-border rounded-card p-5">
          <h2 className="font-semibold text-sm mb-4">{t("suppliers.cols.name")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><label className={lbl}>{t("suppliers.cols.name")}</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className={lbl}>{t("customers.cols.phone")}</label><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div><label className={lbl}>Email</label><input className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="md:col-span-2"><label className={lbl}>{t("customers.fields.address")}</label><input className={input} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            <div><label className={lbl}>{t("customers.fields.taxCode")}</label><input className={input} value={taxCode} onChange={(e) => setTaxCode(e.target.value)} /></div>
            <div className="md:col-span-2"><label className={lbl}>{t("customers.fields.note")}</label><input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
        </section>

        <section className="bg-surface border border-border rounded-card overflow-x-auto">
          <div className="px-5 py-3 border-b border-border font-semibold text-sm">
            {t("suppliers.purchaseHistory")} ({purchases.length})
          </div>
          {purchases.length === 0 ? (
            <p className="p-6 text-sm text-slate-400 text-center">{t("suppliers.noPurchases")}</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">{t("purchases.cols.code")}</th>
                  <th className="px-5 py-2.5 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-5 py-2.5 font-semibold text-right">{t("purchases.cols.itemCount")}</th>
                  <th className="px-5 py-2.5 font-semibold text-right">{t("purchases.cols.total")}</th>
                  <th className="px-5 py-2.5 font-semibold text-right">{t("orders.cols.remaining")}</th>
                  <th className="px-5 py-2.5 font-semibold">{t("orders.cols.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {purchases.map((p) => {
                  const owed = Number(p.total) - Number(p.amountPaid);
                  return (
                    <tr key={p.id} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5 font-medium">{p.code}</td>
                      <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-500">{p.itemCount}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(p.total))}</td>
                      <td className={cn("px-5 py-2.5 text-right tabular-nums", owed > 0 ? "text-warn font-semibold" : "text-slate-400")}>{owed > 0 ? formatCurrency(owed) : "—"}</td>
                      <td className="px-5 py-2.5">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          p.status === "returned" ? "bg-warn-soft text-warn"
                          : p.status === "cancelled" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400"
                          : "bg-ok-soft text-ok")}>
                          {t(`purchases.status.${p.status}` as never)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
