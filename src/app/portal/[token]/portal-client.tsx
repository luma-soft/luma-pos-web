"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Minus, Plus, Search, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { createPortalOrder } from "@/lib/actions/portal";

interface PortalProduct {
  id: string; name: string; sku: string; baseUnit: string; price: number;
}

interface Props {
  token: string;
  customerName: string;
  customerType: string;
  products: PortalProduct[];
}

export function PortalClient({ token, customerName, customerType, products }: Props) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [projectName, setProjectName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneCode, setDoneCode] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [search, products]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const total = lines.reduce((s, [id, q]) => s + (byId.get(id)?.price ?? 0) * q, 0);

  function setQty(id: string, qty: number) {
    setCart((c) => ({ ...c, [id]: Math.max(0, qty) }));
  }

  async function submit() {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await createPortalOrder({
      token,
      projectName: projectName || undefined,
      note: note || undefined,
      items: lines.map(([productId, quantity]) => ({ productId, quantity })),
    });
    setBusy(false);
    if (res.ok) {
      setDoneCode(res.data.code);
      setCart({});
    } else {
      setError(t("portal.errors.submit"));
    }
  }

  if (doneCode) {
    return (
      <div className="min-h-screen bg-canvas grid place-items-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-md shadow-sm">
          <div className="w-16 h-16 rounded-full bg-ok-soft grid place-items-center mx-auto text-3xl">✅</div>
          <h1 className="text-xl font-bold mt-4">{t("portal.success.title")}</h1>
          <p className="text-slate-500 text-sm mt-2">
            {t("portal.success.code")}: <b className="text-slate-900">{doneCode}</b><br />
            {t("portal.success.description")}
          </p>
          <button onClick={() => setDoneCode("")} className="mt-5 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium">
            {t("portal.success.newOrder")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-slate-900">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div>
          <b>{t("portal.title", { customer: customerName })}</b>
          <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-warn-soft text-warn">
            {priceTypeLabel(customerType, t)}
          </span>
        </div>
        <div className="flex-1" />
        <div className="text-sm">
          🛒 {t("portal.cart.itemCount", { count: lines.length })} · <b className="text-blue-600 tabular-nums">{formatCurrency(total)}</b>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* catalog */}
        <div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t("portal.searchPlaceholder")}
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-card border border-slate-300 bg-white"
            />
          </div>
          <div className="bg-white border border-slate-200 rounded-card divide-y divide-slate-100 overflow-hidden">
            {filtered.slice(0, 100).map((p) => {
              const qty = cart[p.id] ?? 0;
              return (
                <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.sku} · <b className="text-blue-600">{formatCurrency(p.price)}</b>/{p.baseUnit}</div>
                  </div>
                  {qty > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setQty(p.id, qty - 1)} className="w-7 h-7 rounded-md border border-slate-200 grid place-items-center"><Minus className="w-3 h-3" /></button>
                      <input
                        type="number" min={0} value={qty}
                        onChange={(e) => setQty(p.id, Number(e.target.value))}
                        className="w-16 px-1 py-1 text-center text-sm rounded-md border border-slate-200 tabular-nums"
                      />
                      <button onClick={() => setQty(p.id, qty + 1)} className="w-7 h-7 rounded-md border border-slate-200 grid place-items-center"><Plus className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <button onClick={() => setQty(p.id, 1)} className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium">{t("portal.add")}</button>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-400">{t("portal.noProducts")}</p>}
          </div>
        </div>

        {/* cart */}
        <div className="bg-white border border-slate-200 rounded-card p-4 self-start space-y-3">
          <b className="text-sm">{t("portal.cart.title")}</b>
          {lines.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">{t("portal.cart.empty")}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map(([id, q]) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <div key={id} className="py-2 flex items-center gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-slate-400">{q} {p.baseUnit} × {formatCurrency(p.price)}</div>
                    </div>
                    <span className="tabular-nums font-medium">{formatCurrency(p.price * q)}</span>
                    <button onClick={() => setQty(id, 0)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={t("portal.projectPlaceholder")}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("portal.notePlaceholder")}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          <div className="flex justify-between text-sm pt-1 border-t border-slate-100">
            <b>{t("portal.cart.subtotal")}</b>
            <b className="text-blue-600 tabular-nums">{formatCurrency(total)}</b>
          </div>
          {error && <p className="text-xs text-er">{error}</p>}
          <button
            onClick={submit} disabled={busy || lines.length === 0}
            className={cn("w-full py-3 rounded-card text-white font-semibold text-sm flex items-center justify-center gap-2", "bg-blue-600 hover:bg-blue-700 disabled:opacity-50")}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("portal.submit")}
          </button>
          <p className="text-[11px] text-slate-400 text-center">{t("portal.footnote")}</p>
        </div>
      </div>
    </div>
  );
}

function priceTypeLabel(type: string, t: ReturnType<typeof useTranslations>) {
  if (type === "retail" || type === "wholesale" || type === "contractor" || type === "agent") {
    return t(`portal.priceTypes.${type}`);
  }
  return type;
}
