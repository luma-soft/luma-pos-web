"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Search, Plus, Minus, Trash2, Loader2, Check, ChefHat, Split, X } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { setTableCart, checkoutTable, closeTable, sendToKitchen } from "@/lib/actions/tables";
import type { TableCartItem, CartModifier } from "@/lib/schemas/table";
import type { ModifierGroup } from "@/lib/data/modifiers";
import type { PosProduct } from "@/lib/data/pos";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { catalogItemToPosProduct } from "@/lib/pos/product-catalog-adapter";

type Method = "cash" | "bank_transfer" | "credit";
const METHODS: Method[] = ["cash", "bank_transfer", "credit"];
const uid = () => Math.random().toString(36).slice(2, 9);
type PosResult = PosProduct;

export function TableOrder({ id, name, initialCart, modifierGroups }: { id: string; name: string; initialCart: TableCartItem[]; modifierGroups: ModifierGroup[] }) {
  const t = useTranslations();
  const router = useRouter();
  const catalog = useProductCatalog();
  const [cart, setCart] = useState<TableCartItem[]>(initialCart);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PosResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [picker, setPicker] = useState<{ product: PosResult; groups: ModifierGroup[] } | null>(null);
  const [split, setSplit] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [guests, setGuests] = useState(2);
  const sref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const hasUnsent = cart.some((i) => !i.sent);
  const payable = split && selected.length ? cart.filter((i) => selected.includes(i.lineId)).reduce((s, i) => s + i.unitPrice * i.quantity, 0) : total;

  function persist(next: TableCartItem[]) { setCart(next); setTableCart(id, next); }

  function onSearch(v: string) {
    setQ(v); if (sref.current) clearTimeout(sref.current);
    if (!v.trim()) { setResults([]); return; }
    setSearching(true);
    sref.current = setTimeout(() => {
      setResults(catalog.search(v, { limit: 30 }).map((product) =>
        catalogItemToPosProduct(product, catalog.products, catalog.snapshot?.warehouses.find((warehouse) => warehouse.isDefault)?.id ?? null)
      ));
      setSearching(false);
    }, 250);
  }

  function groupsFor(categoryId: string | null) {
    return modifierGroups.filter((g) => g.categoryIds.length === 0 || (categoryId && g.categoryIds.includes(categoryId)));
  }

  function choose(p: PosResult) {
    setQ(""); setResults([]);
    const groups = groupsFor(p.categoryId ?? null);
    if (groups.length === 0) addLine(p, [], "");
    else setPicker({ product: p, groups });
  }

  function addLine(p: PosResult, modifiers: CartModifier[], note: string) {
    const base = Number(p.retailPrice);
    const unitPrice = base + modifiers.reduce((s, m) => s + m.priceDelta, 0);
    if (modifiers.length === 0 && !note) {
      const ex = cart.findIndex((c) => c.productId === p.id && !c.sent && c.modifiers.length === 0 && !c.note);
      if (ex >= 0) { const c = [...cart]; c[ex] = { ...c[ex], quantity: c[ex].quantity + 1 }; persist(c); return; }
    }
    persist([...cart, { lineId: uid(), productId: p.id, productName: p.name, unitName: p.baseUnit, unitMultiplier: 1, quantity: 1, basePrice: base, unitPrice, modifiers, note: note || undefined, course: "asap", courseDelayMinutes: 0, sent: false }]);
  }

  const setQty = (lineId: string, d: number) => {
    const c = cart.map((i) => i).filter(Boolean);
    const idx = c.findIndex((i) => i.lineId === lineId);
    if (idx < 0 || c[idx].sent) return;
    const nq = c[idx].quantity + d;
    if (nq <= 0) persist(c.filter((_, x) => x !== idx));
    else { const n = [...c]; n[idx] = { ...n[idx], quantity: nq }; persist(n); }
  };
  const removeLine = (lineId: string) => persist(cart.filter((i) => i.lineId !== lineId));

  function send() {
    setErr("");
    const fresh = cart.filter((i) => !i.sent);
    if (fresh.length === 0) return;
    start(async () => {
      const res = await sendToKitchen(id);
      if (!res.ok) { setErr(t(res.error as never)); return; }
      printTicket(name, fresh, t);
      setCart((c) => c.map((i) => (i.sent ? i : { ...i, sent: true })));
    });
  }

  function pay(method: Method) {
    setErr("");
    const lineIds = split && selected.length ? selected : undefined;
    start(async () => {
      const res = await checkoutTable(id, method, lineIds);
      if (res.ok) {
        void catalog.refresh();
        router.push("/tables");
      }
      else setErr(t(res.error as never));
    });
  }
  function close() { start(async () => { await closeTable(id); router.push("/tables"); }); }

  function toggleSelect(lineId: string) { setSelected((s) => (s.includes(lineId) ? s.filter((x) => x !== lineId) : [...s, lineId])); }

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-13 px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <button onClick={() => router.push("/tables")} className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <h1 className="text-[17px] font-bold">{name}</h1>
        <button onClick={close} disabled={pending} className="ml-auto shrink-0 text-xs text-slate-500 hover:text-er">{t("tables.close")}</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <div>
          <div className="relative w-full max-w-md mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={t("pos.searchPlaceholder")} className="w-full pl-9 pr-3 py-2.5 text-sm rounded-[10px] border border-border bg-surface" />
            {(results.length > 0 || searching) && q.trim() && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-e2 overflow-hidden max-h-[min(70dvh,520px)] overflow-y-auto">
                {searching ? <div className="px-4 py-4 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
                  : results.slice(0, 30).map((p) => (
                    <button key={p.id} onClick={() => choose(p)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                      <span className="truncate">{p.name}</span><span className="font-mono text-primary-600 shrink-0">{formatCurrency(Number(p.retailPrice))}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-card shadow-e1 flex flex-col self-start">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-bold text-sm">{t("tables.order")}</span>
            {cart.length > 0 && (
              <button onClick={() => { setSplit((s) => !s); setSelected([]); }} className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full", split ? "bg-primary-600 text-white" : "text-slate-500 hover:bg-surface-2")}><Split className="w-3.5 h-3.5" />{t("tables.split")}</button>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{t("tables.emptyCart")}</p>
          ) : (
            <div className="divide-y divide-border-soft max-h-[46vh] overflow-auto">
              {cart.map((c) => (
                <div key={c.lineId} className="px-3 py-2.5 flex items-start gap-2 text-sm">
                  {split && (
                    <input type="checkbox" checked={selected.includes(c.lineId)} onChange={() => toggleSelect(c.lineId)} className="mt-1 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-1.5">{c.productName}{c.sent && <ChefHat className="w-3 h-3 text-ok shrink-0" />}</div>
                    {c.modifiers.length > 0 && <div className="text-[11px] text-slate-400 truncate">{c.modifiers.map((m) => m.label).join(", ")}</div>}
                    {c.note && <div className="text-[11px] text-warn truncate">“{c.note}”</div>}
                    <div className="text-xs text-slate-400 font-mono">{formatCurrency(c.unitPrice)}</div>
                  </div>
                  {c.sent ? (
                    <span className="w-6 text-center font-mono pt-0.5">{c.quantity}</span>
                  ) : (
                    <>
                      <button onClick={() => setQty(c.lineId, -1)} className="w-7 h-7 rounded-md border border-border grid place-items-center shrink-0"><Minus className="w-3 h-3" /></button>
                      <span className="w-6 text-center font-mono pt-1">{c.quantity}</span>
                      <button onClick={() => setQty(c.lineId, 1)} className="w-7 h-7 rounded-md border border-border grid place-items-center shrink-0"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => removeLine(c.lineId)} className="text-slate-400 hover:text-er pt-1 shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-t border-border">
            <button onClick={send} disabled={pending || !hasUnsent} className="w-full mb-3 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-[10px] border border-primary-600 text-primary-700 dark:text-primary-300 text-sm font-semibold disabled:opacity-40">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChefHat className="w-4 h-4" />}{t("tables.sendKitchen")}
            </button>

            {split ? (
              <>
                <div className="flex items-center justify-between text-sm mb-2"><span className="text-slate-500">{t("tables.selectedTotal")}</span><span className="font-mono font-bold">{formatCurrency(payable)}</span></div>
                <div className="flex items-center justify-between gap-2 mb-3 text-sm">
                  <span className="text-slate-500">{t("tables.guests")}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} className="w-16 px-2 py-1 text-sm rounded-lg border border-border bg-canvas font-mono text-right" />
                    <span className="font-mono font-bold text-primary-600">{formatCurrency(Math.ceil(payable / guests))}/{t("tables.perGuest")}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex justify-between font-bold mb-3"><span>{t("pos.total")}</span><span className="font-mono">{formatCurrency(total)}</span></div>
            )}

            {err && <p className="text-xs text-er mb-2">{err}</p>}
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button key={m} disabled={pending || cart.length === 0 || (split && selected.length === 0)} onClick={() => pay(m)} className="inline-flex flex-col items-center gap-1 px-2 py-2.5 rounded-[10px] bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t(`pos.payMethods.${m}` as never)}
                </button>
              ))}
            </div>
            {split && <p className="text-[11px] text-slate-400 mt-2 text-center">{t("tables.splitHint")}</p>}
          </div>
        </div>
      </div>

      {picker && <ModifierPicker product={picker.product} groups={picker.groups} onCancel={() => setPicker(null)} onConfirm={(mods, note) => { addLine(picker.product, mods, note); setPicker(null); }} />}
    </div>
  );
}

function ModifierPicker({ product, groups, onCancel, onConfirm }: { product: PosResult; groups: ModifierGroup[]; onCancel: () => void; onConfirm: (mods: CartModifier[], note: string) => void }) {
  const t = useTranslations();
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  function pick(g: ModifierGroup, optId: string) {
    setSel((s) => {
      const cur = s[g.id] ?? [];
      if (g.multi) return { ...s, [g.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] };
      return { ...s, [g.id]: cur.includes(optId) ? [] : [optId] };
    });
  }

  function confirm() {
    for (const g of groups) if (g.required && !(sel[g.id]?.length)) { setErr(t("modifiers.requiredErr", { name: g.name })); return; }
    const mods: CartModifier[] = [];
    for (const g of groups) for (const id of sel[g.id] ?? []) {
      const o = g.options.find((x) => x.id === id);
      if (o) mods.push({ label: o.label, priceDelta: o.priceDelta });
    }
    onConfirm(mods, note.trim());
  }

  const extra = groups.reduce((s, g) => s + (sel[g.id] ?? []).reduce((a, id) => a + (g.options.find((o) => o.id === id)?.priceDelta ?? 0), 0), 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md bg-surface rounded-card shadow-e2 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-surface">
          <h2 className="font-bold truncate">{product.name}</h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="text-[11px] font-bold uppercase text-slate-500 mb-1.5">{g.name}{g.required && <span className="text-er"> *</span>}{g.multi && <span className="text-slate-400 normal-case font-medium"> · {t("modifiers.multiSelect")}</span>}</div>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id);
                  return (
                    <button key={o.id} onClick={() => pick(g, o.id)} className={cn("text-sm px-3 py-1.5 rounded-full border transition", on ? "bg-primary-600 text-white border-primary-600" : "border-border hover:bg-surface-2")}>
                      {o.label}{o.priceDelta ? <span className={cn("font-mono ml-1", on ? "text-white/80" : "text-primary-600")}>+{formatCurrency(o.priceDelta)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-500 mb-1.5">{t("tables.lineNote")}</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("tables.lineNotePlaceholder")} className="w-full px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" />
          </div>
          {err && <p className="text-sm text-er">{err}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border sticky bottom-0 bg-surface">
          <span className="font-mono font-bold">{formatCurrency(Number(product.retailPrice) + extra)}</span>
          <button onClick={confirm} className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold rounded-full bg-primary-600 text-white"><Plus className="w-4 h-4" />{t("tables.addToOrder")}</button>
        </div>
      </div>
    </div>
  );
}

/** In phiếu bếp qua cửa sổ mới (tách biệt CSS app). */
function printTicket(tableName: string, items: TableCartItem[], t: ReturnType<typeof useTranslations>) {
  const w = window.open("", "_blank", "width=320,height=600");
  if (!w) return;
  const rows = items.map((i) => `
    <div style="margin:6px 0;border-bottom:1px dashed #999;padding-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:15px">
        <span>${escapeHtml(i.productName)}</span><span>x${i.quantity}</span>
      </div>
      ${i.modifiers.length ? `<div style="font-size:12px;color:#444">${i.modifiers.map((m) => escapeHtml(m.label)).join(", ")}</div>` : ""}
      ${i.note ? `<div style="font-size:12px;font-style:italic">“${escapeHtml(i.note)}”</div>` : ""}
    </div>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t("tables.kitchenTicket")}</title></head>
    <body style="font-family:monospace;padding:10px;width:280px">
      <div style="text-align:center;font-weight:800;font-size:17px">${t("tables.kitchenTicket")}</div>
      <div style="text-align:center;margin-bottom:8px">${escapeHtml(tableName)} · ${new Date().toLocaleTimeString()}</div>
      ${rows}
    </body></html>`);
  w.document.close(); w.focus(); w.print();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
