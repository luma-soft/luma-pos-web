"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { createCategoryNode, updateCategory, deleteCategory } from "@/lib/actions/products";

interface Cat { id: string; name: string; parentId: string | null; parentName: string | null; productCount: number; }
interface ParentOption { id: string; name: string; }

export function CategoriesManager({ categories: initial, parentOptions: initialParentOptions, total }: { categories: Cat[]; parentOptions: ParentOption[]; total: number }) {
  const t = useTranslations();
  const [cats, setCats] = useState(initial);
  const [parentOptions, setParentOptions] = useState(initialParentOptions);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);
  const [query, setQuery] = useState("");

  // modal tạo mới
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [creating, setCreating] = useState(false);

  const roots = parentOptions;

  async function rename(id: string, name: string) {
    setEditing(null);
    const n = name.trim();
    if (!n) return;
    setCats((cs) => cs.map((c) => c.id === id ? { ...c, name: n } : c.parentId === id ? { ...c, parentName: n } : c));
    const res = await updateCategory(id, { name: n });
    if (!res.ok) setError(t(res.error as never));
    else setParentOptions((options) => options.map((option) => option.id === id ? { ...option, name: n } : option));
  }

  function requestRemove(category: Cat) {
    if (category.productCount > 0) {
      setPendingDelete(category);
      return;
    }
    void remove(category.id);
  }

  async function remove(id: string) {
    setError("");
    setBusy(id);
    const res = await deleteCategory(id);
    setBusy(null);
    if (res.ok) {
      setCats((cs) => cs.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null, parentName: null } : c)));
      setParentOptions((options) => options.filter((option) => option.id !== id));
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
      const parentName = roots.find((root) => root.id === newParent)?.name ?? null;
      setCats((cs) => [...cs, { id: res.data.id, name: n, parentId: newParent || null, parentName, productCount: 0 }]);
      if (!newParent) setParentOptions((options) => [...options, { id: res.data.id, name: n }]);
      setNewName(""); setNewParent(""); setOpen(false);
    } else setError(t(res.error as never));
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (category: Cat) => category.name.toLocaleLowerCase().includes(normalizedQuery);
  const allChildrenOf = (id: string) => cats.filter((c) => c.parentId === id);
  const rows = cats.filter((category) => {
    if (category.parentId) return false;
    if (!normalizedQuery || matchesQuery(category)) return true;
    return allChildrenOf(category.id).some(matchesQuery);
  });
  const childrenOf = (id: string) => {
    const children = allChildrenOf(id);
    if (!normalizedQuery) return children;
    const parentMatches = cats.some((category) => category.id === id && matchesQuery(category));
    return parentMatches ? children : children.filter(matchesQuery);
  };

  function CategoryName({ c }: { c: Cat }) {
    const isEditing = editing?.id === c.id;
    return (
      isEditing ? (
        <input
          autoFocus
          value={editing.name}
          onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
          onBlur={() => rename(c.id, editing.name)}
          onKeyDown={(e) => { if (e.key === "Enter") rename(c.id, editing.name); if (e.key === "Escape") setEditing(null); }}
          className="min-h-11 w-full max-w-sm rounded border border-primary-400 bg-white px-2 text-sm dark:bg-slate-900 lg:min-h-0 lg:py-1"
        />
      ) : (
        <span className={cn("font-medium", c.parentId && "pl-6")}>{c.name}</span>
      )
    );
  }

  function Actions({ c }: { c: Cat }) {
    return (
      <div className="flex items-center justify-end gap-1" onClick={stopRowToggle}>
        <button onClick={() => setEditing({ id: c.id, name: c.name })} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-primary-600 lg:min-h-0 lg:min-w-0 lg:p-1.5" title={t("common.edit")}>
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => requestRemove(c)} disabled={busy === c.id} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-red-500 disabled:opacity-50 lg:min-h-0 lg:min-w-0 lg:p-1.5" title={t("common.delete")}>
          {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  const columns: DataTableColumn<Cat>[] = [
    { key: "name", label: t("categories.name"), required: true, render: (c) => <CategoryName c={c} /> },
    { key: "parent", label: t("categories.parent"), defaultVisible: true, render: (c) => <span className="text-slate-500">{c.parentName ?? "—"}</span> },
    { key: "productCount", label: t("categories.productCount"), defaultVisible: true, align: "right", render: (c) => <span className="tabular-nums text-slate-600">{c.productCount}</span> },
    { key: "actions", label: t("common.actions"), required: true, align: "right", render: (c) => <Actions c={c} /> },
  ];

  return (
    <div className="w-full min-w-0">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("categories.title")}
            aria-label={t("categories.title")}
            className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary-500"
          />
        </label>
        <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 px-3 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 min-w-11">
          <Plus className="w-4 h-4" /> {t("categories.create")}
        </button>
      </div>

      <p className="mb-3 text-sm text-slate-500">{t("categories.count", { n: total })}</p>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <DataTableShell
        tableId="products.categories"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth="720px"
        maxHeight="calc(100dvh - 250px)"
        fillHeight
        canExpand={(row) => childrenOf(row.id).length > 0}
        empty={<p className="rounded-card border border-border-soft bg-surface p-8 text-center text-sm text-slate-400">{t("categories.empty")}</p>}
        renderMobileRow={({ row, toggle, expanded }) => (
          <div className="flex items-center justify-between gap-3 p-3">
            <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") toggle(); }} className="min-h-11 min-w-11 flex-1 space-y-1 text-left lg:min-h-0 lg:min-w-0">
              <CategoryName c={row} />
              <div className="text-xs text-slate-500">
                {row.parentName ?? t("categories.noParent")} · {row.productCount} {t("categories.productCount")}
              </div>
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
            <Actions c={row} />
          </div>
        )}
        renderExpanded={(row) => {
          const children = childrenOf(row.id);
          if (children.length === 0) return null;
          return (
            <div className="divide-y divide-border-soft bg-surface-2/45">
              {children.map((child) => (
                <div key={child.id} className="grid grid-cols-1 items-center gap-3 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(10rem,1fr)_8rem_5rem]">
                  <CategoryName c={child} />
                  <span className="text-slate-500">{child.parentName ?? "—"}</span>
                  <span className="text-right tabular-nums text-slate-600">{child.productCount}</span>
                  <Actions c={child} />
                </div>
              ))}
            </div>
          );
        }}
      />

      {/* modal tạo nhóm hàng */}
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold">{t("categories.create")}</h3>
              <button onClick={() => setOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("categories.name")}</label>
                <input
                  autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-11 lg:min-h-0"
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
              <button onClick={() => setOpen(false)} className="min-h-11 px-4 text-sm rounded-lg border border-slate-300 dark:border-slate-700 min-w-11">{t("common.cancel")}</button>
              <button onClick={create} disabled={creating || !newName.trim()} className="inline-flex min-h-11 items-center gap-1.5 px-4 text-sm rounded-lg bg-primary-600 text-white font-medium disabled:opacity-50 min-w-11">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={() => setPendingDelete(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-border-soft px-5 py-4">
              <h3 className="font-bold text-slate-900 dark:text-slate-100">{t("categories.deleteWarningTitle")}</h3>
            </div>
            <div className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
              {t("categories.deleteWarning", { name: pendingDelete.name, count: pendingDelete.productCount })}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-soft px-5 py-3">
              <button type="button" onClick={() => setPendingDelete(null)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-2 min-w-11">{t("common.cancel")}</button>
              <button type="button" onClick={() => { const id = pendingDelete.id; setPendingDelete(null); void remove(id); }} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 min-w-11">{t("categories.deleteAnyway")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
