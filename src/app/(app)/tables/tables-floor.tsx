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
        <button onClick={() => { setMergeMode((m) => !m); setSelected([]); }} className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition", mergeMode ? "bg-primary-600 text-white" : "border border-border hover:bg-surface-2")}>
          <GitMerge className="w-4 h-4" />{t("tables.merge")}
        </button>
        {canManage && (
          <button onClick={() => setManage((m) => !m)} className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition", manage ? "bg-primary-600 text-white" : "border border-border hover:bg-surface-2")}>
            <Settings2 className="w-4 h-4" />{t("tables.manage")}
          </button>
        )}
      </div>

      {mergeMode && <p className="mb-4 text-sm text-slate-500">{t("tables.mergeHint")}</p>}

      {manage && (
        <div className="flex flex-wrap items-end gap-2 mb-5 p-4 bg-surface border border-border rounded-card">
          <div className="flex flex-col gap-1"><span className="text-[9px] font-bold uppercase text-slate-500">{t("tables.tableName")}</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("tables.tableName")} className="px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" /></div>
          <div className="flex flex-col gap-1"><span className="text-[9px] font-bold uppercase text-slate-500">{t("tables.zone")}</span><input value={newZone} onChange={(e) => setNewZone(e.target.value)} placeholder={t("tables.zone")} className="px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" /></div>
          <button disabled={pending} onClick={add} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50"><Plus className="w-4 h-4" />{t("tables.addTable")}</button>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400"><p className="font-medium">{t("tables.empty")}</p></div>
      ) : zones.map((zone) => (
        <div key={zone || "_"} className="mb-6">
          {zone && <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{zone}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {tables.filter((x) => x.zone === zone).map((tb) => {
              const occ = tb.status === "occupied";
              const sel = selected.includes(tb.id);
              const selIdx = selected.indexOf(tb.id);
              return (
                <div key={tb.id} className={cn("relative rounded-card border p-4 text-left transition", sel ? "bg-primary-600 text-white border-primary-600" : occ ? "bg-primary-50 dark:bg-primary-950/30 border-primary-500" : "bg-surface border-border hover:border-primary-400", mergeMode && !occ && "opacity-40")}>
                  <button onClick={() => clickTable(tb)} className="block w-full text-left" disabled={pending}>
                    <div className="font-bold">{tb.name}</div>
                    <div className={cn("text-[11px] font-semibold mt-1", sel ? "text-white/80" : occ ? "text-primary-600" : "text-slate-400")}>{occ ? t("tables.occupied") : t("tables.free")}</div>
                    {occ && <div className={cn("mt-2 font-mono text-sm font-bold", sel && "text-white")}>{formatCurrency(tb.total)}<span className={cn("text-[10px] font-sans", sel ? "text-white/70" : "text-slate-400")}> · {tb.itemCount}</span></div>}
                  </button>
                  {sel && <span className="absolute top-2 right-2 w-5 h-5 grid place-items-center rounded-full bg-white text-primary-700 text-[11px] font-bold">{selIdx === 0 ? "★" : selIdx + 1}</span>}
                  {manage && !mergeMode && (
                    <button onClick={() => start(async () => { await deleteTable(tb.id); router.refresh(); })} className="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-er hover:bg-surface-2"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {mergeMode && selected.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-surface border border-border shadow-e2">
          <span className="text-sm">{t("tables.mergeInto", { count: selected.length, name: targetName ?? "" })}</span>
          <button onClick={() => setSelected([])} className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><X className="w-4 h-4" /></button>
          <button disabled={pending} onClick={doMerge} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}{t("tables.mergeConfirm")}</button>
        </div>
      )}

      {pending && !mergeMode && <div className="fixed bottom-6 right-6 z-50 px-3 py-2 rounded-xl bg-surface border border-border shadow-e2 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /></div>}
    </>
  );
}
