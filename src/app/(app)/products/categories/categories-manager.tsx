"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronRight, Ellipsis, Folder, FolderPlus, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { createCategoryNode, updateCategory, deleteCategory } from "@/lib/actions/products";

interface Cat { id: string; name: string; parentId: string | null; parentName: string | null; productCount: number; }
interface ParentOption { id: string; name: string; }

export function CategoriesManager({ categories: initial, parentOptions: initialParentOptions, total, loadMore }: {
  categories: Cat[];
  parentOptions: ParentOption[];
  total: number;
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<Cat>;
}) {
  const t = useTranslations();
  const [cats, setCats] = useState(initial);
  // Pages loaded on phones join the locally edited list.
  const { rows: loadedCats, footer: loadMoreFooter } = useMobileLoadMore(initial, loadMore, (category) => category.id);
  const [mergedCount, setMergedCount] = useState(initial.length);
  if (loadedCats.length > mergedCount) {
    const extra = loadedCats.slice(mergedCount);
    setMergedCount(loadedCats.length);
    setCats((current) => [...current, ...extra.filter((category) => !current.some((item) => item.id === category.id))]);
  }
  const [parentOptions, setParentOptions] = useState(initialParentOptions);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<Cat | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
      {/* Phones: CategoryManagementView's search field with the inline add-folder button. */}
      <div className="relative mb-2 lg:hidden">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[19px] -translate-y-1/2 text-ios-label-secondary" strokeWidth={2.2} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("mobile.categories.search")}
          aria-label={t("mobile.categories.search")}
          className="h-12 w-full rounded-2xl border border-ios-stroke/50 bg-[rgb(118_118_128/0.12)] pl-11 pr-14 text-[17px] outline-none placeholder:text-ios-label-secondary focus:border-ios-accent dark:bg-[rgb(118_118_128/0.24)]"
        />
        <button
          type="button"
          onClick={() => { setNewParent(""); setOpen(true); }}
          aria-label={t("mobile.categories.add")}
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-[10px] bg-ios-accent/12 text-ios-accent"
        >
          <FolderPlus className="size-5" strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      <div className="mb-3 flex flex-col gap-2 max-lg:hidden sm:flex-row sm:items-center sm:justify-between">
        <label className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClick={selectAllInputOnClick}
            placeholder={t("categories.title")}
            aria-label={t("categories.title")}
            className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary-500"
          />
        </label>
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4" /> {t("categories.create")}
        </Button>
      </div>

      <p className="mb-3 text-sm text-slate-500 max-lg:hidden">{t("categories.count", { n: total })}</p>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      <DataTableShell
        tableId="products.categories"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth="720px"
        maxHeight="calc(100dvh - 250px)"
        fillHeight
        resetScrollKey={query}
        canExpand={(row) => childrenOf(row.id).length > 0}
        empty={<p className="rounded-card border border-border-soft bg-surface p-8 text-center text-sm text-slate-400">{t("categories.empty")}</p>}
        mobileListClassName="max-lg:-mx-4 max-lg:space-y-0 max-lg:bg-surface"
        mobileRowClassName="max-lg:rounded-none max-lg:border-0 max-lg:bg-[linear-gradient(var(--color-border),var(--color-border))] max-lg:bg-[length:100%_1px] max-lg:bg-left-bottom max-lg:bg-no-repeat"
        // Phones: CategoryManagementTreeView rows with children expanding inline.
        renderMobileRow={({ row }) => {
          const children = childrenOf(row.id);
          const expanded = expandedIds.has(row.id) || (normalizedQuery !== "" && children.length > 0);
          return (
            <div>
              <MobileCategoryRow
                category={row}
                depth={0}
                hasChildren={children.length > 0}
                expanded={expanded}
                editing={editing?.id === row.id}
                name={<CategoryName c={row} />}
                onToggle={() => setExpandedIds((current) => {
                  const next = new Set(current);
                  if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                  return next;
                })}
                onMenu={() => setMenuFor(row)}
              />
              {expanded && children.map((child) => (
                <MobileCategoryRow
                  key={child.id}
                  category={child}
                  depth={1}
                  hasChildren={false}
                  expanded={false}
                  editing={editing?.id === child.id}
                  name={<CategoryName c={child} />}
                  onToggle={() => {}}
                  onMenu={() => setMenuFor(child)}
                />
              ))}
            </div>
          );
        }}
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
      {loadMoreFooter}
      <MobileActionSheet open={Boolean(menuFor)} onClose={() => setMenuFor(null)} title={menuFor?.name}>
        {menuFor && (
          <div className="space-y-2">
            <MenuAction icon={Pencil} label={t("mobile.categories.rename")} onSelect={() => setEditing({ id: menuFor.id, name: menuFor.name })} />
            {!menuFor.parentId && (
              <MenuAction icon={FolderPlus} label={t("mobile.categories.addChild")} onSelect={() => { setNewParent(menuFor.id); setOpen(true); }} />
            )}
            <MenuAction icon={Trash2} label={t("mobile.categories.remove")} destructive onSelect={() => requestRemove(menuFor)} />
          </div>
        )}
      </MobileActionSheet>

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

/** One row of CategoryManagementTreeView: chevron, folder, name with count, "…" menu. */
function MobileCategoryRow({
  category,
  depth,
  hasChildren,
  expanded,
  editing,
  name,
  onToggle,
  onMenu,
}: {
  category: Cat;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  editing: boolean;
  name: ReactNode;
  onToggle: () => void;
  onMenu: () => void;
}) {
  const t = useTranslations("mobile.categories");
  return (
    <div
      className={cn(
        "flex min-h-[62px] items-center gap-2 py-2 pl-ios-inset pr-2",
        // Child rows get the list hairline, inset to their indentation.
        depth > 0 && "bg-[linear-gradient(var(--color-border),var(--color-border))] bg-[length:100%_1px] bg-right-top bg-no-repeat",
      )}
      style={{ paddingLeft: 16 + depth * 18 }}
    >
      {hasChildren ? (
        <button type="button" onClick={onToggle} aria-label={t(expanded ? "collapse" : "expand")} aria-expanded={expanded} className="grid h-9 w-[30px] shrink-0 place-items-center text-ios-label-secondary">
          <ChevronRight className={cn("size-[14px] transition-transform", expanded && "rotate-90")} strokeWidth={2.8} aria-hidden="true" />
        </button>
      ) : null}
      <Folder className={cn("size-[22px] shrink-0 text-ios-accent", depth === 0 && "fill-current")} strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1 pl-1 [&_span.font-medium]:pl-0 [&_span.font-medium]:text-[17px]">
        {name}
        {!editing && (
          <div className="mt-0.5 text-[12px] text-ios-label-secondary">
            {t("productCount", { count: category.productCount })}{category.parentName ? ` · ${category.parentName}` : ""}
          </div>
        )}
      </div>
      <button type="button" onClick={onMenu} aria-label={t("actionsFor", { name: category.name })} className="grid size-9 shrink-0 place-items-center text-ios-accent">
        <Ellipsis className="size-5" strokeWidth={2.6} aria-hidden="true" />
      </button>
    </div>
  );
}
