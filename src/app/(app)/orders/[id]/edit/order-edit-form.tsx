"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Save, Trash2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { updateOrder } from "@/lib/actions/order-edit";
import { useProductCatalog } from "@/components/product-catalog-provider";

interface Line {
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
}

interface Props {
  orderId: string;
  orderCode: string;
  initial: {
    projectName: string; note: string; discount: number; shippingFee: number; amountPaid: number;
    items: Line[];
  };
}

export function OrderEditForm({ orderId, orderCode, initial }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const { products: productOptions } = useProductCatalog();

  const [items, setItems] = useState<Line[]>(initial.items);
  const [discount, setDiscount] = useState(initial.discount);
  const [shippingFee, setShippingFee] = useState(initial.shippingFee);
  const [projectName, setProjectName] = useState(initial.projectName);
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const productById = useMemo(() => new Map(productOptions.map((p) => [p.id, p])), [productOptions]);

  const subtotal = items.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount + shippingFee);
  const oldTotal = Math.max(0, initial.items.reduce((s, l) => s + l.quantity * l.unitPrice, 0) - initial.discount + initial.shippingFee);
  const delta = total - oldTotal;
  const newRemaining = Math.max(0, total - initial.amountPaid);

  function patch(idx: number, p: Partial<Line>) {
    setItems((ls) => ls.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  }

  function addProduct(id: string) {
    const p = productById.get(id);
    if (!p) return;
    setItems((ls) => [...ls, {
      productId: p.id, productName: p.name,
      unitName: p.baseUnit, unitMultiplier: 1,
      quantity: 1, unitPrice: Number(p.retailPrice),
    }]);
  }

  async function save() {
    if (items.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await updateOrder({
      orderId,
      projectName: projectName || undefined,
      note: note || undefined,
      discount,
      shippingFee,
      items: items.filter((l) => l.quantity > 0),
    });
    setBusy(false);
    if (res.ok) router.push(Routes.salesOrder(orderId, "completed"));
    else setError(t(res.error as never));
  }

  const inputCls = "px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums";

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => router.push(Routes.salesOrder(orderId, "completed"))} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold">{t("orderEdit.title", { code: orderCode })}</h1>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-card p-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
        {t("orderEdit.warning")}
      </div>

      <div className="bg-surface border border-border rounded-card overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3 font-semibold">{t("orders.cols.product")}</th>
              <th className="px-4 py-3 font-semibold">{t("orders.cols.unit")}</th>
              <th className="px-4 py-3 font-semibold text-right w-28">{t("orders.cols.qty")}</th>
              <th className="px-4 py-3 font-semibold text-right w-36">{t("orders.cols.unitPrice")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {items.map((l, idx) => (
              <tr key={`${l.productId}-${idx}`}>
                <td className="px-4 py-2.5 font-medium">{l.productName}</td>
                <td className="px-4 py-2.5 text-slate-500">{l.unitName}</td>
                <td className="px-4 py-2.5 text-right">
                  <input type="number" min={0} value={l.quantity}
                    onChange={(e) => patch(idx, { quantity: Math.max(0, Number(e.target.value)) })}
                    className={cn(inputCls, "w-24 text-right")} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <MoneyInput value={l.unitPrice}
                    onChange={(v) => patch(idx, { unitPrice: v ?? 0 })}
                    className={cn(inputCls, "w-32 text-right")} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(l.quantity * l.unitPrice)}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => setItems((ls) => ls.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-border">
          <Select
            value=""
            onChange={(e) => addProduct(e.target.value)}
            options={[
              { value: "", label: `＋ ${t("purchases.addProduct")}` },
              ...productOptions.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` })),
            ]}
            className="w-full border-dashed bg-transparent text-slate-500"
          />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-card p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("pos.discount")}</label>
            <MoneyInput value={discount} onChange={(v) => setDiscount(v ?? 0)} className={cn(inputCls, "w-full text-right")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("pos.shipping")}</label>
            <MoneyInput value={shippingFee} onChange={(v) => setShippingFee(v ?? 0)} className={cn(inputCls, "w-full text-right")} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("orders.cols.project")}</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className={cn(inputCls, "w-full")} />
          </div>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("orders.detail.notePlaceholder")} className={cn(inputCls, "w-full")} />

        <div className="flex items-end justify-between flex-wrap gap-4 pt-2 border-t border-border">
          <div className="text-sm space-y-1">
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.oldTotal")}</span><span className="tabular-nums line-through text-slate-400">{formatCurrency(oldTotal)}</span></div>
            <div className="flex gap-6 justify-between"><b>{t("orderEdit.newTotal")}</b><b className="tabular-nums text-primary-600">{formatCurrency(total)}</b></div>
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.delta")}</span>
              <span className={cn("tabular-nums font-semibold", delta > 0 ? "text-warn" : delta < 0 ? "text-ok" : "text-slate-400")}>
                {delta >= 0 ? "+" : ""}{formatCurrency(delta)}
              </span>
            </div>
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.newRemaining")}</span><span className="tabular-nums font-semibold text-er">{formatCurrency(newRemaining)}</span></div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {error && <p className="text-sm text-er">{error}</p>}
            <button onClick={save} disabled={busy || items.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("orderEdit.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
