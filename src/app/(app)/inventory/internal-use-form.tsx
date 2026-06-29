"use client";

import { type ReactNode, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, Trash2, Check, Loader2, AlertTriangle, FileSpreadsheet, Printer, Eye, CircleAlert, PackageSearch, Save, ClipboardList } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { searchPurchaseProducts } from "@/lib/actions/purchase-search";
import { createInternalUse } from "@/lib/actions/internal-use";
import { Routes } from "@/lib/routes";
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
        router.push(`${Routes.Inventory}?tab=internal`);
        setTimeout(() => setToast(""), 3500);
      } else {
        setToast(t(res.error as never));
        setTimeout(() => setToast(""), 3500);
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 overflow-hidden rounded-card bg-surface shadow-[0_14px_36px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft bg-surface px-4 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-200">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-36">
              <h2 className="text-lg font-extrabold">{t("nav.internalUse")}</h2>
              <p className="text-[11px] text-slate-400">{t("internalUse.formSub")}</p>
            </div>
            <div className="relative min-w-64 flex-1 xl:max-w-xl">
              <Input
                value={q}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t("internalUse.searchProduct")}
                leftIcon={<Search />}
                size="lg"
                className="h-12 bg-canvas text-base"
              />
              {(results.length > 0 || searching) && q.trim() && (
                <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-card border border-border-soft bg-surface shadow-e2">
                  {searching ? <div className="px-4 py-4 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
                    : results.map((p) => (
                      <button key={p.id} type="button" onClick={() => addItem(p)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-surface-2">
                        <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.name}</div><div className="font-mono text-xs text-slate-400">{p.sku} · {t("internalUse.cost")} {formatCurrency(Number(p.costPrice))}/{p.baseUnit}</div></div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <IconAction label="file"><FileSpreadsheet className="h-4 w-4" /></IconAction>
              <IconAction label="print"><Printer className="h-4 w-4" /></IconAction>
              <IconAction label="preview"><Eye className="h-4 w-4" /></IconAction>
              <IconAction label="notice"><CircleAlert className="h-4 w-4" /></IconAction>
            </div>
        </div>

        {needsApproval && (
          <div className="m-4 flex items-start gap-2 rounded-card border border-warn/20 bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{t("internalUse.approvalBanner", { amount: formatCurrency(totalCost) })}</span>
          </div>
        )}

          <div className="grid grid-cols-2 gap-2 border-b border-border-soft bg-canvas/45 px-4 py-3 text-xs sm:grid-cols-4">
            <FormMetric label={t("internalUse.cols.items")} value={String(lines.length)} />
            <FormMetric label={t("internalUse.qty")} value={String(lines.reduce((sum, line) => sum + line.quantity, 0))} />
            <FormMetric label={t("internalUse.totalCost")} value={formatCurrency(totalCost)} tone={needsApproval ? "warn" : "primary" } />
            <FormMetric label={t("internalUse.status.draft")} value={needsApproval ? t("internalUse.status.pending") : t("internalUse.status.approved")} tone={needsApproval ? "warn" : "ok"} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] table-fixed text-sm">
              <colgroup>
                <col className="w-16" />
                <col className="w-36" />
                <col />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-34" />
                <col className="w-36" />
                <col className="w-12" />
              </colgroup>
              <thead>
                <tr className="border-b border-border-soft bg-canvas text-left text-xs font-semibold text-slate-600">
                  <th className="px-3 py-3 text-center">{t("internalUse.cols.no")}</th>
                  <th className="px-3 py-3">{t("internalUse.cols.sku")}</th>
                  <th className="px-3 py-3">{t("internalUse.cols.product")}</th>
                  <th className="px-3 py-3">{t("internalUse.unit")}</th>
                  <th className="px-3 py-3 text-right">{t("internalUse.qty")}</th>
                  <th className="px-3 py-3 text-right">{t("internalUse.unitCost")}</th>
                  <th className="px-3 py-3 text-right">{t("internalUse.lineTotal")}</th>
                  <th />
                </tr>
              </thead>
              {lines.length > 0 && (
                <tbody>
                  {lines.map((l, index) => (
                    <tr key={l.key} className="border-b border-border-soft transition hover:bg-surface-2/70">
                      <td className="px-3 py-3 text-center font-mono text-slate-500">{index + 1}</td>
                      <td className="px-3 py-3 font-mono text-primary-600">{l.productId.slice(0, 8)}</td>
                      <td className="px-3 py-3 font-semibold">{l.productName}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={l.unitName}
                          onChange={(e) => changeUnit(l, e.target.value)}
                          size="sm"
                          options={l.units.map((u) => ({ value: u.name, label: `${u.name}${u.mult > 1 ? ` (×${u.mult})` : ""}` }))}
                          className="bg-canvas"
                        />
                      </td>
                      <td className="px-3 py-2"><Input type="number" min={1} value={l.quantity} onChange={(e) => upd(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} size="sm" className="no-spinner bg-canvas text-right font-mono" /></td>
                      <td className="px-3 py-2"><Input type="number" min={0} value={l.unitCost} onChange={(e) => upd(l.key, { unitCost: Math.max(0, Number(e.target.value) || 0) })} size="sm" className="no-spinner bg-canvas text-right font-mono" /></td>
                      <td className="px-3 py-3 text-right font-mono font-bold">{formatCurrency(l.unitCost * l.quantity)}</td>
                      <td className="px-3 py-2"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-er-soft hover:text-er active:scale-[0.98]"><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>

          {lines.length === 0 && (
            <div className="p-4 sm:p-6">
              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-card bg-canvas/55 px-4 text-center">
                <PackageSearch className="mb-4 h-10 w-10 text-slate-300" />
                <p className="text-lg font-extrabold">{t("internalUse.emptyForm")}</p>
                <p className="mt-2 text-sm text-slate-400">{t("internalUse.emptyHint")}</p>
                <Button type="button" className="mt-8" size="lg">
                  <FileSpreadsheet className="h-4 w-4" />
                  {t("internalUse.chooseFile")}
                </Button>
              </div>
            </div>
          )}
      </section>

      <aside className="flex flex-col rounded-card bg-surface p-4 shadow-[0_14px_36px_rgba(15,23,42,0.05)] xl:sticky xl:top-24 xl:self-start">
          <div className="mb-5 flex items-center justify-between gap-3">
            <SearchableSelect options={[{ value: "main", label: t("internalUse.defaultBranch") }]} value="main" onChange={() => undefined} placeholder={t("internalUse.defaultBranch")} />
            <div className="h-10 rounded-lg border border-border-soft bg-canvas px-3 py-2 text-sm font-semibold text-slate-400">{new Date().toLocaleDateString("vi-VN")}</div>
          </div>

          <div className="space-y-4 text-sm">
            <PanelRow label={t("internalUse.autoCodeLabel")}><span className="rounded-lg border border-border-soft bg-canvas px-3 py-2 font-semibold text-slate-400">{t("internalUse.autoCode")}</span></PanelRow>
            <PanelRow label={t("internalUse.statusLabel")}><span className="font-semibold">{t("internalUse.status.draft")}</span></PanelRow>
            <PanelRow label={t("internalUse.reason")}><SearchableSelect options={reasonOpts} value={reason} onChange={setReason} placeholder={t("internalUse.reasonPlaceholder")} /></PanelRow>
            <PanelRow label={t("internalUse.department")}><SearchableSelect options={deptOpts} value={department} onChange={setDepartment} placeholder={t("internalUse.departmentPlaceholder")} /></PanelRow>
            <PanelRow label={t("internalUse.totalCost")}><span className={cn("font-mono text-lg font-extrabold", needsApproval ? "text-warn" : "text-primary-700")}>{formatCurrency(totalCost)}</span></PanelRow>
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("internalUse.notePlaceholder")}
            className="mt-6 min-h-28 bg-canvas"
          />

          <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
            <Button type="button" variant="outline" size="lg" disabled={pending || lines.length === 0} loading={pending} onClick={submit} block>
              {!pending && <Save className="h-4 w-4" />}
              {t("stocktakes.saveDraft")}
            </Button>
            <Button type="button" size="lg" disabled={pending || lines.length === 0} loading={pending} onClick={submit} className={needsApproval ? "bg-warn hover:bg-warn/90" : undefined} block>
              {!pending && <Check className="w-4 h-4" />}
              {needsApproval ? t("internalUse.submitForApproval") : t("internalUse.complete")}
            </Button>
          </div>
      </aside>

      {toast && <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-ok-soft text-ok border border-ok/25 text-sm font-semibold shadow-e2 flex items-center gap-2"><Check className="w-4 h-4" />{toast}</div>}
    </div>
  );
}

function IconAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-soft bg-surface text-slate-500 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 active:scale-[0.98]">
      {children}
    </button>
  );
}

function PanelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3">
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </div>
  );
}

function FormMetric({ label, value, tone }: { label: string; value: string; tone?: "primary" | "ok" | "warn" }) {
  return (
    <div className="rounded-lg bg-surface/80 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-slate-400">{label}</div>
      <div className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", tone === "primary" && "text-primary-700", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
