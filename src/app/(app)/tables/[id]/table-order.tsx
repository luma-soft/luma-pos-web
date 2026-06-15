"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Search, Plus, Minus, Trash2, Loader2, Check } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { searchPosProducts } from "@/lib/actions/pos-search";
import { setTableCart, checkoutTable, closeTable } from "@/lib/actions/tables";
import type { TableCartItem } from "@/lib/data/tables";

const METHODS: Array<"cash" | "bank_transfer" | "credit"> = ["cash", "bank_transfer", "credit"];

export function TableOrder({ id, name, initialCart }: { id: string; name: string; initialCart: TableCartItem[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [cart, setCart] = useState<TableCartItem[]>(initialCart);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPosProducts>>>([]);
  const [searching, setSearching] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const sref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  function persist(next: TableCartItem[]) { setCart(next); setTableCart(id, next); }
  function onSearch(v: string) {
    setQ(v); if (sref.current) clearTimeout(sref.current);
    if (!v.trim()) { setResults([]); return; }
    setSearching(true);
    sref.current = setTimeout(async () => { setResults(await searchPosProducts(v)); setSearching(false); }, 250);
  }
  function add(p: Awaited<ReturnType<typeof searchPosProducts>>[number]) {
    const ex = cart.findIndex((c) => c.productId === p.id);
    if (ex >= 0) { const c = [...cart]; c[ex] = { ...c[ex], quantity: c[ex].quantity + 1 }; persist(c); }
    else persist([...cart, { productId: p.id, productName: p.name, unitName: p.baseUnit, unitMultiplier: 1, quantity: 1, unitPrice: Number(p.retailPrice) }]);
    setQ(""); setResults([]);
  }
  const setQty = (i: number, d: number) => { const c = [...cart]; const nq = c[i].quantity + d; if (nq <= 0) c.splice(i, 1); else c[i] = { ...c[i], quantity: nq }; persist(c); };
  const removeAt = (i: number) => persist(cart.filter((_, x) => x !== i));

  function pay(method: "cash" | "bank_transfer" | "credit") {
    setErr("");
    start(async () => { const res = await checkoutTable(id, method); if (res.ok) router.push("/tables"); else setErr(t(res.error as never)); });
  }
  function close() { start(async () => { await closeTable(id); router.push("/tables"); }); }

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-13 px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <button onClick={() => router.push("/tables")} className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <h1 className="text-[17px] font-bold">{name}</h1>
        <button onClick={close} disabled={pending} className="ml-auto text-xs text-slate-500 hover:text-er">{t("tables.close")}</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div>
          <div className="relative max-w-md mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={t("pos.searchPlaceholder")} className="w-full pl-9 pr-3 py-2.5 text-sm rounded-[10px] border border-border bg-surface" />
            {(results.length > 0 || searching) && q.trim() && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-e2 overflow-hidden">
                {searching ? <div className="px-4 py-4 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
                  : results.slice(0, 30).map((p) => (
                    <button key={p.id} onClick={() => add(p)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                      <span className="truncate">{p.name}</span><span className="font-mono text-primary-600 shrink-0">{formatCurrency(Number(p.retailPrice))}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-card shadow-e1 flex flex-col self-start">
          <div className="px-4 py-3 border-b border-border font-bold text-sm">{t("tables.order")}</div>
          {cart.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{t("tables.emptyCart")}</p>
          ) : (
            <div className="divide-y divide-border-soft max-h-[50vh] overflow-auto">
              {cart.map((c, i) => (
                <div key={c.productId} className="px-3 py-2.5 flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1"><div className="font-medium truncate">{c.productName}</div><div className="text-xs text-slate-400 font-mono">{formatCurrency(c.unitPrice)}</div></div>
                  <button onClick={() => setQty(i, -1)} className="w-7 h-7 rounded-md border border-border grid place-items-center"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center font-mono">{c.quantity}</span>
                  <button onClick={() => setQty(i, 1)} className="w-7 h-7 rounded-md border border-border grid place-items-center"><Plus className="w-3 h-3" /></button>
                  <button onClick={() => removeAt(i)} className="text-slate-400 hover:text-er"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-3 border-t border-border">
            <div className="flex justify-between font-bold mb-3"><span>{t("pos.total")}</span><span className="font-mono">{formatCurrency(total)}</span></div>
            {err && <p className="text-xs text-er mb-2">{err}</p>}
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button key={m} disabled={pending || cart.length === 0} onClick={() => pay(m)} className="inline-flex flex-col items-center gap-1 px-2 py-2.5 rounded-[10px] bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t(`pos.payMethods.${m}` as never)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
