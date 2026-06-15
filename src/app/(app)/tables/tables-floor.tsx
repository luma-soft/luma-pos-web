"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Settings2, Trash2, Loader2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { openTable, createTable, deleteTable } from "@/lib/actions/tables";
import type { TableRow } from "@/lib/data/tables";

export function TablesFloor({ tables, canManage }: { tables: TableRow[]; canManage: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [manage, setManage] = useState(false);
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState("");

  const zones = Array.from(new Set(tables.map((x) => x.zone)));
  if (zones.length === 0) zones.push("");

  function openAndGo(tb: TableRow) {
    start(async () => { if (tb.status === "free") await openTable(tb.id); router.push(`/tables/${tb.id}`); });
  }
  function add() {
    if (!newName.trim()) return;
    start(async () => { await createTable(newName, newZone); setNewName(""); router.refresh(); });
  }

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-13 px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-[17px] font-bold">{t("tables.title")}</h1>
        {canManage && (
          <button onClick={() => setManage((m) => !m)} className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition", manage ? "bg-primary-600 text-white" : "border border-border hover:bg-surface-2")}>
            <Settings2 className="w-4 h-4" />{t("tables.manage")}
          </button>
        )}
      </div>

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
              return (
                <div key={tb.id} className={cn("relative rounded-card border p-4 text-left transition", occ ? "bg-primary-50 dark:bg-primary-950/30 border-primary-500" : "bg-surface border-border hover:border-primary-400")}>
                  <button onClick={() => openAndGo(tb)} className="block w-full text-left" disabled={pending}>
                    <div className="font-bold">{tb.name}</div>
                    <div className={cn("text-[11px] font-semibold mt-1", occ ? "text-primary-600" : "text-slate-400")}>{occ ? t("tables.occupied") : t("tables.free")}</div>
                    {occ && <div className="mt-2 font-mono text-sm font-bold">{formatCurrency(tb.total)}<span className="text-[10px] text-slate-400 font-sans"> · {tb.itemCount}</span></div>}
                  </button>
                  {manage && (
                    <button onClick={() => start(async () => { await deleteTable(tb.id); router.refresh(); })} className="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-er hover:bg-surface-2"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {pending && <div className="fixed bottom-6 right-6 z-50 px-3 py-2 rounded-xl bg-surface border border-border shadow-e2 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /></div>}
    </div>
  );
}
