"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createCategoryNode, updateCategory, deleteCategory } from "@/lib/actions/products";

interface Cat { id: string; name: string; parentId: string | null; productCount: number; }

export function CategoriesManager({ categories: initial }: { categories: Cat[] }) {
  const t = useTranslations();
  const [cats, setCats] = useState(initial);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // modal tạo mới
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [creating, setCreating] = useState(false);

  const roots = cats.filter((c) => !c.parentId);
  const childrenOf = (id: string) => cats.filter((c) => c.parentId === id);

  async function rename(id: string, name: string) {
    setEditing(null);
    const n = name.trim();
    if (!n) return;
    setCats((cs) => cs.map((c) => (c.id === id ? { ...c, name: n } : c)));
    const res = await updateCategory(id, { name: n });
    if (!res.ok) setError(t(res.error as never));
  }

  async function remove(id: string) {
    setError("");
    setBusy(id);
    const res = await deleteCategory(id);
    setBusy(null);
    if (res.ok) {
      setCats((cs) => cs.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null } : c)));
    } else setError(t(res.error as never));
  }

  async function create() {
    const n = newName.trim();
    if (!n) return;
    setCreating(true);
    setError("");
    const res = await createCategoryNode({ name: n, parentId: newParent || null });
    setCreating(false);
    if (res.ok) {
      setCats((cs) => [...cs, { id: res.data.id, name: n, parentId: newParent || null, productCount: 0 }]);
      setNewName(""); setNewParent(""); setOpen(false);
    } else setError(t(res.error as never));
  }

  function Row({ c, child = false }: { c: Cat; child?: boolean }) {
    const isEditing = editing?.id === c.id;
    return (
      <div className={cn("group flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50", child && "pl-9")}>
        {isEditing ? (
          <input
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
            onBlur={() => rename(c.id, editing.name)}
            onKeyDown={(e) => { if (e.key === "Enter") rename(c.id, editing.name); if (e.key === "Escape") setEditing(null); }}
            className="flex-1 px-2 py-1 text-sm rounded border border-primary-400 bg-white dark:bg-slate-900"
          />
        ) : (
          <>
            <span className="flex-1 text-sm">
              {c.name}
              <span className="text-xs text-slate-400 ml-1.5">({c.productCount})</span>
            </span>
            <button onClick={() => setEditing({ id: c.id, name: c.name })} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-primary-600" title={t("common.edit")}>
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => remove(c.id)} disabled={busy === c.id} className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 disabled:opacity-50" title={t("common.delete")}>
              {busy === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-500">{t("categories.count", { n: cats.length })}</span>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
          <Plus className="w-4 h-4" /> {t("categories.create")}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {cats.length === 0 && <p className="p-8 text-center text-sm text-slate-400">{t("categories.empty")}</p>}
        {roots.map((r) => (
          <div key={r.id}>
            <Row c={r} />
            {childrenOf(r.id).map((ch) => <Row key={ch.id} c={ch} child />)}
          </div>
        ))}
      </div>

      {/* modal tạo nhóm hàng */}
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold">{t("categories.create")}</h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("categories.name")}</label>
                <input
                  autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("categories.parent")}</label>
                <Select
                  value={newParent} onChange={(e) => setNewParent(e.target.value)}
                  options={[{ value: "", label: t("categories.noParent") }, ...roots.map((r) => ({ value: r.id, label: r.name }))]}
                  className="w-full border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-800">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700">{t("common.cancel")}</button>
              <button onClick={create} disabled={creating || !newName.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white font-medium disabled:opacity-50">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
