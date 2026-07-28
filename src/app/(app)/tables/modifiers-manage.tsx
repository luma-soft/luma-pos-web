"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Loader2, X, Check } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { saveModifierGroup, setModifierGroupActive, deleteModifierGroup } from "@/lib/actions/modifiers";
import type { ModifierGroup } from "@/lib/data/modifiers";
import { NumberInput } from "@/components/ui/number-input";

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
        <button onClick={startNew} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white min-w-11"><Plus className="w-4 h-4" />{t("modifiers.add")}</button>
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
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <button
                    onClick={() => toggle(g.id, !g.isActive)}
                    title={t("modifiers.toggle")}
                    aria-pressed={g.isActive}
                    className={cn("min-h-11 rounded-full px-3 py-1 text-[10px] font-bold min-w-11", g.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}
                  >
                    {g.isActive ? t("common.active") : t("common.inactive")}
                  </button>
                  <button onClick={() => startEdit(g)} aria-label={`${t("common.edit")} ${g.name}`} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-surface-2"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(g.id)} aria-label={`${t("common.delete")} ${g.name}`} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-surface-2 hover:text-er"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 sm:p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-auto rounded-card bg-surface shadow-e2 sm:max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border sticky top-0 bg-surface">
              <h2 className="font-bold">{editId ? t("modifiers.editTitle") : t("modifiers.add")}</h2>
              <button onClick={() => setOpen(false)} aria-label={t("common.close")} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-surface-2"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.name")}</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("modifiers.namePlaceholder")} className="mt-1 min-h-11 w-full rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm" />
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-surface-2 min-w-11"><input type="checkbox" checked={form.multi} onChange={(e) => setForm((f) => ({ ...f, multi: e.target.checked }))} />{t("modifiers.multiSelect")}</label>
                <label className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-surface-2 min-w-11"><input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} />{t("modifiers.required")}</label>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.options")}</label>
                <div className="mt-1 space-y-2">
                  {form.options.map((o, i) => (
                    <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2.75rem]">
                      <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} placeholder={t("modifiers.optionLabel")} className="min-h-11 rounded-[10px] border border-border bg-canvas px-3 py-2 text-sm min-w-11" />
                      <NumberInput value={o.priceDelta} onChange={(priceDelta) => setOpt(i, { priceDelta: priceDelta ?? 0 })} placeholder="+0" className="min-h-11 min-w-0 rounded-[10px] bg-canvas px-2 font-mono" />
                      <button
                        onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, x) => x !== i) }))}
                        aria-label={`${t("common.delete")} ${o.label || t("modifiers.optionLabel")}`}
                        className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-er-soft hover:text-er"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setForm((f) => ({ ...f, options: [...f.options, { id: uid(), label: "", priceDelta: 0 }] }))} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-primary-600 hover:bg-primary-50 min-w-11"><Plus className="w-3 h-3" />{t("modifiers.addOption")}</button>
                </div>
              </div>

              {categories.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500">{t("modifiers.applyCategories")}</label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const on = form.categoryIds.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => setForm((f) => ({ ...f, categoryIds: on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id] }))} aria-pressed={on} className={cn("min-h-11 min-w-11 rounded-full border px-3 py-1 text-xs transition", on ? "bg-primary-600 text-white border-primary-600" : "border-border text-slate-500 hover:bg-surface-2")}>{c.name}</button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{t("modifiers.applyHint")}</p>
                </div>
              )}

              {err && <p className="text-sm text-er">{err}</p>}
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:py-3">
              <button onClick={() => setOpen(false)} className="min-h-11 rounded-full border border-border px-4 py-2 text-sm hover:bg-surface-2 min-w-11">{t("common.cancel")}</button>
              <button onClick={save} disabled={pending} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 min-w-11">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
