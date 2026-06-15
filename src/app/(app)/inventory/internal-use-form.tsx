"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, Trash2, Check, Loader2, AlertTriangle } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { searchPurchaseProducts } from "@/lib/actions/purchase-search";
import { createInternalUse } from "@/lib/actions/internal-use";
import { formatCurrency, cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const APPROVAL_THRESHOLD = 500_000;

const DEPARTMENTS = [
  ["kitchen", "Kitchen", "Bếp"], ["office", "Office", "Văn phòng"], ["marketing", "Marketing", "Tiếp thị"],
  ["management", "Management", "Ban quản lý"], ["security", "Security", "Bảo vệ"], ["maintenance", "Maintenance", "Bảo trì"],
] as const;
const REASONS = [
  ["staff_meal", "Staff meals", "Bữa ăn nhân viên"], ["supplies", "Office supplies", "Vật tư văn phòng"],
  ["sample", "Marketing samples", "Mẫu tiếp thị"], ["display", "Store display", "Trưng bày"],
  ["cleaning", "Cleaning supplies", "Vệ sinh"], ["training", "Staff training", "Đào tạo nhân viên"],
  ["other", "Other", "Khác"],
] as const;

type Line = {
  key: string; productId: string; productName: string; baseUnit: string; costPrice: number;
  units: { name: string; mult: number }[]; unitName: string; unitMultiplier: number; quantity: number; unitCost: number;
};

export function InternalUseForm() {
  const t = useTranslations();
  const locale = useLocale();
  const L = locale === "vi";
  const router = useRouter();
  const [pending, start] = useTransition();

  const [department, setDepartment] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPurchaseProducts>>>([]);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState("");
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deptOpts = DEPARTMENTS.map(([v, en, vi]) => ({ value: v, label: L ? vi : en }));
  const reasonOpts = REASONS.map(([v, en, vi]) => ({ value: v, label: L ? vi : en }));
  const labelOf = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;

  const totalCost = useMemo(() => lines.reduce((s, l) => s + l.unitCost * l.quantity, 0), [lines]);
  const needsApproval = totalCost > APPROVAL_THRESHOLD;

  function onSearch(val: string) {
    setQ(val);
    if (tRef.current) clearTimeout(tRef.current);
    if (!val.trim()) { setResults([]); return; }
    setSearching(true);
    tRef.current = setTimeout(async () => {
      const rows = await searchPurchaseProducts(val);
      setResults(rows); setSearching(false);
    }, 250);
  }

  function addItem(p: Awaited<ReturnType<typeof searchPurchaseProducts>>[number]) {
    const cost = Number(p.costPrice);
    const units = [{ name: p.baseUnit, mult: 1 }, ...p.units.map((u) => ({ name: u.unitName, mult: Number(u.multiplier) }))];
    setLines((ls) => {
      const ex = ls.findIndex((x) => x.productId === p.id);
      if (ex >= 0) { const c = [...ls]; c[ex] = { ...c[ex], quantity: c[ex].quantity + 1 }; return c; }
      return [...ls, { key: `${p.id}-${Date.now()}`, productId: p.id, productName: p.name, baseUnit: p.baseUnit, costPrice: cost, units, unitName: p.baseUnit, unitMultiplier: 1, quantity: 1, unitCost: cost }];
    });
    setQ(""); setResults([]);
  }
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => l.key === key ? { ...l, ...patch } : l));
  const changeUnit = (l: Line, name: string) => {
    const u = l.units.find((x) => x.name === name) ?? l.units[0];
    upd(l.key, { unitName: u.name, unitMultiplier: u.mult, unitCost: Math.round(l.costPrice * u.mult) });
  };

  function submit() {
    if (lines.length === 0) return;
    start(async () => {
      const res = await createInternalUse({
        department: department ? labelOf(deptOpts, department) : undefined,
        reason: reason ? labelOf(reasonOpts, reason) : undefined,
        note: note || undefined,
        items: lines.map((l) => ({ productId: l.productId, productName: l.productName, unitName: l.unitName, unitMultiplier: l.unitMultiplier, quantity: l.quantity, unitCost: l.unitCost })),
      });
      if (res.ok) {
        setToast(res.data.status === "pending" ? t("internalUse.submittedPending") : t("internalUse.submitted"));
        setLines([]); setNote(""); setReason(""); setDepartment("");
        router.refresh();
        setTimeout(() => setToast(""), 3500);
      } else {
        setToast(t(res.error as never));
        setTimeout(() => setToast(""), 3500);
      }
    });
  }

  return (
    <div className="bg-surface rounded-card shadow-e2 mb-5">
      <div className="px-4.5 py-3 border-b border-border bg-canvas rounded-t-card">
        <div className="text-sm font-bold">{t("internalUse.formTitle")}</div>
        <div className="text-[10px] italic text-slate-400 mt-px">{t("internalUse.formSub")}</div>
      </div>
      <div className="p-4.5 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{t("internalUse.department")}</span>
            <SearchableSelect options={deptOpts} value={department} onChange={setDepartment} placeholder={t("internalUse.department")} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{t("internalUse.reason")}</span>
            <SearchableSelect options={reasonOpts} value={reason} onChange={setReason} placeholder={t("internalUse.reason")} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{t("internalUse.note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("internalUse.notePlaceholder")} className="w-full px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" />
        </div>

        {/* product search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder={t("internalUse.searchProduct")} className="w-full pl-9 pr-3 py-2.5 text-sm rounded-[10px] border border-border bg-canvas" />
          {(results.length > 0 || searching) && q.trim() && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-e2 overflow-hidden">
              {searching ? <div className="px-4 py-4 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
                : results.map((p) => (
                  <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                    <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-[10px] text-slate-400 font-mono">{p.sku} · {t("internalUse.cost")} {formatCurrency(Number(p.costPrice))}/{p.baseUnit}</div></div>
                  </button>
                ))}
            </div>
          )}
        </div>

        {needsApproval && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 bg-warn-soft border border-warn/25 rounded-[10px] text-[11px] text-warn">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{t("internalUse.approvalBanner", { amount: formatCurrency(totalCost) })}</span>
          </div>
        )}

        {lines.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400 border border-dashed border-border rounded-[10px]">{t("internalUse.emptyForm")}</div>
        ) : (
          <div className="border border-border rounded-[10px] overflow-x-auto">
            <table className="w-full text-sm min-w-150">
              <thead><tr className="bg-canvas text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-border">
                <th className="px-3 py-2 font-bold">{t("orders.cols.product")}</th>
                <th className="px-3 py-2 font-bold w-36">{t("internalUse.unit")}</th>
                <th className="px-3 py-2 font-bold w-24 text-center">{t("internalUse.qty")}</th>
                <th className="px-3 py-2 font-bold w-32 text-right">{t("internalUse.unitCost")}</th>
                <th className="px-3 py-2 font-bold w-32 text-right">{t("internalUse.lineTotal")}</th>
                <th className="w-8" />
              </tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-border-soft last:border-0">
                    <td className="px-3 py-2 font-medium">{l.productName}</td>
                    <td className="px-3 py-2">
                      <select value={l.unitName} onChange={(e) => changeUnit(l, e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-canvas">
                        {l.units.map((u) => <option key={u.name} value={u.name}>{u.name}{u.mult > 1 ? ` (×${u.mult})` : ""}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="number" min={1} value={l.quantity} onChange={(e) => upd(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="no-spinner w-full px-2 py-1.5 text-center text-sm rounded-md border border-border bg-canvas font-mono" /></td>
                    <td className="px-3 py-2"><input type="number" min={0} value={l.unitCost} onChange={(e) => upd(l.key, { unitCost: Math.max(0, Number(e.target.value) || 0) })} className="no-spinner w-full px-2 py-1.5 text-right text-sm rounded-md border border-border bg-canvas font-mono" /></td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-warn">{formatCurrency(l.unitCost * l.quantity)}</td>
                    <td className="px-3 py-2"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-slate-400 hover:text-er"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lines.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <span className="text-sm">{t("internalUse.totalCost")}: <span className="font-mono font-extrabold text-warn text-base">{formatCurrency(totalCost)}</span></span>
            <button type="button" disabled={pending} onClick={submit} className={cn("inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-white text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50", needsApproval ? "bg-warn hover:brightness-110" : "bg-primary-600 hover:brightness-110")}>
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {needsApproval ? t("internalUse.submitForApproval") : t("internalUse.confirm")}
            </button>
          </div>
        )}
      </div>

      {toast && <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-ok-soft text-ok border border-ok/25 text-sm font-semibold shadow-e2 flex items-center gap-2"><Check className="w-4 h-4" />{toast}</div>}
    </div>
  );
}
