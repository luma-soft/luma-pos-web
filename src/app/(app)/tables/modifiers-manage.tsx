"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Loader2, X, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { saveModifierGroup, setModifierGroupActive, deleteModifierGroup } from "@/lib/actions/modifiers";
import type { ModifierGroup } from "@/lib/data/modifiers";

type Cat = { id: string; name: string };
type OptRow = { id: string; label: string; priceDelta: number };
const uid = () => Math.random().toString(36).slice(2, 9);

function emptyForm() {
  return { name: "", multi: false, required: false, options: [{ id: uid(), label: "", priceDelta: 0 }] as OptRow[], categoryIds: [] as string[] };
}

export function ModifiersManage({ groups, categories }: { groups: ModifierGroup[]; categories: Cat[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [err, setErr] = useState("");

  function startNew() { setEditId(null); setForm(emptyForm()); setErr(""); setOpen(true); }
  function startEdit(g: ModifierGroup) {
    setEditId(g.id);
    setForm({ name: g.name, multi: g.multi, required: g.required, options: g.options.length ? g.options : [{ id: uid(), label: "", priceDelta: 0 }], categoryIds: g.categoryIds });
    setErr(""); setOpen(true);
  }

  function save() {
    setErr("");
    const options = form.options.filter((o) => o.label.trim()).map((o) => ({ id: o.id, label: o.label.trim(), priceDelta: Number(o.priceDelta) || 0 }));
    if (!form.name.trim() || options.length === 0) { setErr(t("errors.invalidData")); return; }
    start(async () => {
      const res = await saveModifierGroup(editId, { name: form.name, multi: form.multi, required: form.required, options, categoryIds: form.categoryIds, sortOrder: 0 });
      if (res.ok) { setOpen(false); router.refresh(); } else setErr(t(res.error as never));
    });
  }
  function remove(id: string) { start(async () => { await deleteModifierGroup(id); router.refresh(); }); }
  function toggle(id: string, v: boolean) { start(async () => { await setModifierGroupActive(id, v); router.refresh(); }); }

  const setOpt = (i: number, patch: Partial<OptRow>) => setForm((f) => ({ ...f, options: f.options.map((o, x) => (x === i ? { ...o, ...patch } : o)) }));
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{t("modifiers.sub")}</p>
        <button onClick={startNew} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold"><Plus className="w-4 h-4" />{t("modifiers.add")}</button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400"><p className="font-medium">{t("modifiers.empty")}</p></div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.id} className={cn("bg-surface border border-border rounded-card p-4", !g.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{g.name}</span>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-surface-2 text-slate-500">{g.multi ? t("modifiers.multi") : t("modifiers.single")}</span>
                    {g.required && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-warn-soft text-warn">{t("modifiers.required")}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.options.map((o) => (
                      <span key={o.id} className="text-xs px-2 py-0.5 rounded-full bg-surface-2 font-medium">{o.label}{o.priceDelta ? <span className="text-primary-600 font-mono"> +{formatCurrency(o.priceDelta)}</span> : null}</span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400">{g.categoryIds.length ? `${t("modifiers.appliesTo")}: ${g.categoryIds.map(catName).join(", ")}` : t("modifiers.allItems")}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggle(g.id, !g.isActive)} title={t("modifiers.toggle")} className={cn("text-[10px] font-bold px-2 py-1 rounded-full", g.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{g.isActive ? t("common.active") : t("common.inactive")}</button>
                  <button onClick={() => startEdit(g)} className="p-1.5 rounded-lg text-slate-400 hover:bg-surface-2"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(g.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-er hover:bg-surface-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg bg-surface rounded-card shadow-e2 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-surface">
              <h2 className="font-bold">{editId ? t("modifiers.editTitle") : t("modifiers.add")}</h2>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.name")}</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("modifiers.namePlaceholder")} className="mt-1 w-full px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.multi} onChange={(e) => setForm((f) => ({ ...f, multi: e.target.checked }))} />{t("modifiers.multiSelect")}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} />{t("modifiers.required")}</label>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.options")}</label>
                <div className="mt-1 space-y-2">
                  {form.options.map((o, i) => (
                    <div key={o.id} className="flex items-center gap-2">
                      <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} placeholder={t("modifiers.optionLabel")} className="flex-1 px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas" />
                      <input type="number" value={o.priceDelta} onChange={(e) => setOpt(i, { priceDelta: Number(e.target.value) })} placeholder="+0" className="w-28 px-3 py-2 text-sm rounded-[10px] border border-border bg-canvas font-mono" />
                      <button onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, x) => x !== i) }))} className="p-1.5 text-slate-400 hover:text-er"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <button onClick={() => setForm((f) => ({ ...f, options: [...f.options, { id: uid(), label: "", priceDelta: 0 }] }))} className="text-xs font-semibold text-primary-600 inline-flex items-center gap-1"><Plus className="w-3 h-3" />{t("modifiers.addOption")}</button>
                </div>
              </div>

              {categories.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.applyCategories")}</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const on = form.categoryIds.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => setForm((f) => ({ ...f, categoryIds: on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id] }))} className={cn("text-xs px-2.5 py-1 rounded-full border transition", on ? "bg-primary-600 text-white border-primary-600" : "border-border text-slate-500 hover:bg-surface-2")}>{c.name}</button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{t("modifiers.applyHint")}</p>
                </div>
              )}

              {err && <p className="text-sm text-er">{err}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border sticky bottom-0 bg-surface">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-full border border-border hover:bg-surface-2">{t("common.cancel")}</button>
              <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-full bg-primary-600 text-white disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
