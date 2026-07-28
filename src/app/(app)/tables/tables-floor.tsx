"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Settings2, Trash2, Loader2, GitMerge, X } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { openTable, createTable, deleteTable, mergeTables } from "@/lib/actions/tables";
import type { TableRow } from "@/lib/data/tables";

export function TablesFloor({ tables, canManage }: { tables: TableRow[]; canManage: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [manage, setManage] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");

  const zones = Array.from(new Set(tables.map((x) => x.zone)));
  if (zones.length === 0) zones.push("");

  function clickTable(tb: TableRow) {
    if (mergeMode) {
      if (tb.status !== "occupied") return;
      setSelected((s) => (s.includes(tb.id) ? s.filter((x) => x !== tb.id) : [...s, tb.id]));
      return;
    }
    start(async () => { if (tb.status === "free") await openTable(tb.id); router.push(`/tables/${tb.id}`); });
  }
  function add() {
    if (!newName.trim()) return;
    start(async () => { await createTable(newName, newZone); setNewName(""); router.refresh(); });
  }
  function doMerge() {
    if (selected.length < 2) return;
    const [target, ...rest] = selected;
    start(async () => { await mergeTables(target, rest); setSelected([]); setMergeMode(false); router.refresh(); });
  }

  const targetName = selected.length ? tables.find((x) => x.id === selected[0])?.name : "";

  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-4">
        <button onClick={() => { setMergeMode((m) => !m); setSelected([]); }} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition min-w-11", mergeMode ? "bg-primary-600 text-white" : "border border-border hover:bg-surface-2")}>
          <GitMerge className="w-4 h-4" />{t("tables.merge")}
        </button>
        {canManage && (
          <button onClick={() => setManage((m) => !m)} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition min-w-11", manage ? "bg-primary-600 text-white" : "border border-border hover:bg-surface-2")}>
            <Settings2 className="w-4 h-4" />{t("tables.manage")}
          </button>
        )}
      </div>

      {mergeMode && <p className="mb-4 text-sm text-slate-500">{t("tables.mergeHint")}</p>}

      {manage && (
        <div className="mb-5 grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <div className="flex min-w-0 flex-col gap-1"><span className="text-[9px] font-bold uppercase text-slate-500">{t("tables.tableName")}</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("tables.tableName")} className="min-h-11 w-full rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm" /></div>
          <div className="flex min-w-0 flex-col gap-1"><span className="text-[9px] font-bold uppercase text-slate-500">{t("tables.zone")}</span><input value={newZone} onChange={(e) => setNewZone(e.target.value)} placeholder={t("tables.zone")} className="min-h-11 w-full rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm" /></div>
          <button disabled={pending} onClick={add} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-1 min-w-11"><Plus className="w-4 h-4" />{t("tables.addTable")}</button>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400"><p className="font-medium">{t("tables.empty")}</p></div>
      ) : zones.map((zone) => (
        <div key={zone || "_"} className="mb-6">
          {zone && <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{zone}</div>}
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {tables.filter((x) => x.zone === zone).map((tb) => {
              const occ = tb.status === "occupied";
              const sel = selected.includes(tb.id);
              const selIdx = selected.indexOf(tb.id);
              return (
                <div key={tb.id} className={cn("relative rounded-card border p-3 text-left transition sm:p-4", sel ? "bg-primary-600 text-white border-primary-600" : occ ? "bg-primary-50 dark:bg-primary-950/30 border-primary-500" : "bg-surface border-border hover:border-primary-400", mergeMode && !occ && "opacity-40")}>
                  <button onClick={() => clickTable(tb)} className={cn("block min-h-20 w-full text-left", manage && !mergeMode && "pr-10")} disabled={pending}>
                    <div className="font-bold">{tb.name}</div>
                    <div className={cn("text-[11px] font-semibold mt-1", sel ? "text-white/80" : occ ? "text-primary-600" : "text-slate-400")}>{occ ? t("tables.occupied") : t("tables.free")}</div>
                    {occ && <div className={cn("mt-2 font-mono text-sm font-bold", sel && "text-white")}>{formatCurrency(tb.total)}<span className={cn("text-[10px] font-sans", sel ? "text-white/70" : "text-slate-400")}> · {tb.itemCount}</span></div>}
                  </button>
                  {sel && <span className="absolute top-2 right-2 w-5 h-5 grid place-items-center rounded-full bg-white text-primary-700 text-[11px] font-bold">{selIdx === 0 ? "★" : selIdx + 1}</span>}
                  {manage && !mergeMode && (
                    <button
                      onClick={() => start(async () => { await deleteTable(tb.id); router.refresh(); })}
                      aria-label={`${t("common.delete")} ${tb.name}`}
                      className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-surface-2 hover:text-er"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {mergeMode && selected.length >= 2 && (
        <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-e2 lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-max lg:-translate-x-1/2 lg:flex-nowrap lg:px-4">
          <span className="min-w-0 flex-1 text-sm lg:flex-none">{t("tables.mergeInto", { count: selected.length, name: targetName ?? "" })}</span>
          <button onClick={() => setSelected([])} aria-label={t("common.close")} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-surface-2"><X className="h-5 w-5" /></button>
          <button disabled={pending} onClick={doMerge} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 min-w-11">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}{t("tables.mergeConfirm")}</button>
        </div>
      )}

      {pending && !mergeMode && <div className="fixed bottom-6 right-6 z-50 px-3 py-2 rounded-xl bg-surface border border-border shadow-e2 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /></div>}
    </>
  );
}
