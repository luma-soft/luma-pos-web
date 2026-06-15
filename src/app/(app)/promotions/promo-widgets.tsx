"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { createPromotion, togglePromotion } from "@/lib/actions/extras";

interface ProductOption { id: string; name: string; sku: string; baseUnit: string }
type Tier = { minQty: number; discountPct: number };

export function PromoQuickCreate({ products }: { products: ProductOption[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [tiers, setTiers] = useState<Tier[]>([{ minQty: 50, discountPct: 3 }]);
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const product = products.find((p) => p.id === productId);

  async function submit() {
    if (!name.trim() || !productId || tiers.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await createPromotion({
      name, productId,
      tiers: tiers.filter((tr) => tr.minQty > 0 && tr.discountPct > 0),
      endsAt: endsAt || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setTiers([{ minQty: 50, discountPct: 3 }]);
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
        <Plus className="w-4 h-4" />
        {t("promos.createNew")}
      </button>
    );
  }

  const cls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  return (
    <div className="bg-surface border border-border rounded-card p-4 w-full max-w-xl space-y-3">
      <div className="flex justify-between items-center">
        <b className="text-sm">{t("promos.createNew")}</b>
        <button onClick={() => setOpen(false)} className="p-1 text-slate-400"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("promos.cols.name")} *`} className={`${cls} flex-1 min-w-44`} />
        <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={cls} title={t("promos.endsAt")} />
      </div>
      <select value={productId} onChange={(e) => setProductId(e.target.value)} className={`${cls} w-full`}>
        <option value="">{t("purchases.pickProduct")}</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
      </select>
      <div className="space-y-2">
        {tiers.map((tier, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">≥</span>
            <input type="number" min={1} value={tier.minQty}
              onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, minQty: Number(e.target.value) } : x))}
              className={`${cls} w-24 text-right`} />
            <span className="text-slate-500">{product?.baseUnit ?? t("purchases.unitLabel")} → {t("promos.discount")}</span>
            <input type="number" min={0} max={100} step={0.5} value={tier.discountPct}
              onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, discountPct: Number(e.target.value) } : x))}
              className={`${cls} w-20 text-right`} />
            <span className="text-slate-500">%</span>
            {tiers.length > 1 && (
              <button onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setTiers((ts) => [...ts, { minQty: (ts[ts.length - 1]?.minQty ?? 0) * 2 || 100, discountPct: (ts[ts.length - 1]?.discountPct ?? 0) + 2 }])}
          className="text-xs font-medium text-primary-600 hover:underline">
          + {t("promos.addTier")}
        </button>
      </div>
      {error && <p className="text-xs text-er">{error}</p>}
      <button onClick={submit} disabled={busy || !name.trim() || !productId}
        className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("common.save")}
      </button>
    </div>
  );
}

export function PromoToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await togglePromotion(id);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button onClick={toggle} disabled={busy} className="text-xs font-medium text-primary-600 hover:underline disabled:opacity-50">
      {isActive ? t("promos.pause") : t("promos.resume")}
    </button>
  );
}
