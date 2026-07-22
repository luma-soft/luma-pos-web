"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Pencil, Plus, X, Calculator } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { createPriceBook, renamePriceBook, deletePriceBook, setProductPrice, applyPriceFormulaAll, type PriceFormulaBase } from "@/lib/actions/price-books";

interface Book { id: string; name: string; isDefault: boolean; sortOrder: number; }
interface Row {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  costPrice: number;
  lastPurchase: number;
  prices: Record<string, number | null>;
}

export function PricingTable({ books: initialBooks, rows: initialRows, total }: { books: Book[]; rows: Row[]; total: number }) {
  const t = useTranslations();
  const router = useRouter();
  const [books, setBooks] = useState(initialBooks);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState("");
  const [savingCell, setSavingCell] = useState<Set<string>>(new Set());
  const [savedCell, setSavedCell] = useState<Set<string>>(new Set());

  // popover "Đặt giá theo công thức"
  const [formula, setFormula] = useState<{ rowId: string; bookId: string } | null>(null);
  const [fBase, setFBase] = useState<PriceFormulaBase>("current");
  const [fOp, setFOp] = useState<"+" | "-">("+");
  const [fAmount, setFAmount] = useState(0);
  const [fUnit, setFUnit] = useState<"vnd" | "pct">("pct");
  const [fAll, setFAll] = useState(false);
  const [applying, setApplying] = useState(false);

  function openFormula(rowId: string, bookId: string) {
    setFBase("current"); setFOp("+"); setFAmount(0); setFUnit("pct"); setFAll(false);
    setFormula({ rowId, bookId });
  }
  function computeNew(row: Row, bookId: string): number {
    const base = fBase === "cost" ? row.costPrice
      : fBase === "lastPurchase" ? row.lastPurchase
      : (row.prices[bookId] ?? row.prices[defaultBookId] ?? 0);
    const delta = fUnit === "pct" ? (base * fAmount) / 100 : fAmount;
    return Math.max(0, Math.round(base + (fOp === "-" ? -delta : delta)));
  }
  async function applyFormula(row: Row, bookId: string) {
    if (fAll) {
      setApplying(true); setError("");
      const res = await applyPriceFormulaAll({ priceBookId: bookId, base: fBase, op: fOp, amount: fAmount, unit: fUnit });
      setApplying(false);
      if (res.ok) { setFormula(null); router.refresh(); }
      else setError(t(res.error as never));
    } else {
      await saveCell(row, bookId, computeNew(row, bookId));
      setFormula(null);
    }
  }

  // quản lý bảng giá
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const defaultBookId = books.find((b) => b.isDefault)?.id ?? books[0]?.id ?? "";
  const cellKey = (rowId: string, bookId: string) => `${rowId}:${bookId}`;
  const formulaRow = formula ? rows.find((row) => row.id === formula.rowId) : null;
  const formulaBook = formula ? books.find((book) => book.id === formula.bookId) : null;

  async function addBook() {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    setError("");
    const res = await createPriceBook(name);
    if (res.ok) {
      setBooks((b) => [...b, { id: res.data.id, name: res.data.name, isDefault: false, sortOrder: b.length }]);
      setRows((rs) => rs.map((r) => ({ ...r, prices: { ...r.prices, [res.data.id]: null } })));
      setNewName("");
      setCreating(false);
    } else setError(t(res.error as never));
  }

  async function rename(id: string, name: string) {
    setEditing(null);
    const n = name.trim();
    if (!n) return;
    setBooks((b) => b.map((x) => (x.id === id ? { ...x, name: n } : x)));
    const res = await renamePriceBook(id, n);
    if (!res.ok) setError(t(res.error as never));
  }

  async function removeBook(id: string) {
    setError("");
    const res = await deletePriceBook(id);
    if (res.ok) {
      setBooks((b) => b.filter((x) => x.id !== id));
      setRows((rs) => rs.map((r) => { const p = { ...r.prices }; delete p[id]; return { ...r, prices: p }; }));
    } else setError(t(res.error as never));
  }

  async function saveCell(row: Row, bookId: string, value: number | null) {
    const k = cellKey(row.id, bookId);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, prices: { ...r.prices, [bookId]: value } } : r)));
    setSavingCell((s) => new Set(s).add(k));
    setSavedCell((s) => { const n = new Set(s); n.delete(k); return n; });
    setError("");
    const res = await setProductPrice({ priceBookId: bookId, productId: row.id, price: value });
    setSavingCell((s) => { const n = new Set(s); n.delete(k); return n; });
    if (res.ok) {
      setSavedCell((s) => new Set(s).add(k));
      setTimeout(() => setSavedCell((s) => { const n = new Set(s); n.delete(k); return n; }), 1500);
    } else setError(t(res.error as never));
  }

  const columns: DataTableColumn<Row>[] = [
    {
      key: "product",
      label: t("orders.cols.product"),
      required: true,
      width: "300px",
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-slate-400">{r.sku} · {r.baseUnit}</div>
        </div>
      ),
    },
    {
      key: "costPrice",
      label: t("pricing.cols.costPrice"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      render: (r) => <span className="tabular-nums text-slate-500">{formatCurrency(r.costPrice)}</span>,
    },
    {
      key: "lastPurchase",
      label: t("pricing.cols.lastPurchase"),
      defaultVisible: true,
      align: "right",
      width: "160px",
      render: (r) => <span className="tabular-nums text-slate-500">{formatCurrency(r.lastPurchase)}</span>,
    },
    ...books.map((b): DataTableColumn<Row> => ({
      key: `book:${b.id}`,
      label: b.name,
      defaultVisible: true,
      align: "right",
      width: "170px",
      render: (r) => {
        const k = cellKey(r.id, b.id);
        const val = r.prices[b.id];
        const fallback = b.id !== defaultBookId && val == null;
        const belowCost = val != null && val > 0 && val < r.costPrice;
        return (
          <div className="relative inline-flex items-center gap-1 group/cell" onClick={stopRowToggle}>
            <button
              type="button"
              onClick={() => openFormula(r.id, b.id)}
              title={t("pricing.formula.title")}
              className="opacity-0 group-hover/cell:opacity-100 p-1 text-slate-400 hover:text-primary-600"
            >
              <Calculator className="w-3.5 h-3.5" />
            </button>
            <MoneyInput
              value={val ?? ""}
              placeholder={fallback ? formatCurrency(r.prices[defaultBookId] ?? 0) : "—"}
              onChange={(v) => {
                setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, prices: { ...x.prices, [b.id]: v } } : x)));
              }}
              onBlur={() => {
                const next = val == null ? (b.id === defaultBookId ? 0 : null) : Math.max(0, val);
                saveCell(r, b.id, next);
              }}
              className={cn(
                "w-28 px-2 py-1.5 text-right text-sm rounded-md border bg-surface tabular-nums",
                belowCost ? "border-red-400 text-er" : "border-slate-200 dark:border-slate-700",
                fallback && "text-slate-400"
              )}
              title={belowCost ? t("pricing.belowCost") : undefined}
            />
            {savingCell.has(k) && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 absolute -right-5" />}
            {savedCell.has(k) && <Check className="w-3.5 h-3.5 text-ok absolute -right-5" />}
          </div>
        );
      },
    })),
  ];

  return (
    <div className="bg-surface border border-border rounded-card overflow-hidden">
      {/* thanh quản lý bảng giá */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-slate-500 mr-1">{t("pricing.booksLabel")}</span>
        {books.map((b) => (
          <span key={b.id} className="group inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 pl-2.5 pr-1.5 py-1 text-sm">
            {editing?.id === b.id ? (
              <input
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                onBlur={() => rename(b.id, editing.name)}
                onKeyDown={(e) => { if (e.key === "Enter") rename(b.id, editing.name); if (e.key === "Escape") setEditing(null); }}
                className="w-28 px-1 py-0.5 text-sm rounded border border-primary-400 bg-surface"
              />
            ) : (
              <>
                <span className={cn(b.isDefault && "font-semibold")}>{b.name}</span>
                <button onClick={() => setEditing({ id: b.id, name: b.name })} className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-primary-600" title={t("common.edit")}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {!b.isDefault && (
                  <button onClick={() => removeBook(b.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500" title={t("common.delete")}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </span>
        ))}
        {creating ? (
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={addBook}
            onKeyDown={(e) => { if (e.key === "Enter") addBook(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            placeholder={t("pricing.newBookPlaceholder")}
            className="w-36 px-2 py-1 text-sm rounded-lg border border-primary-400 bg-surface"
          />
        ) : (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40">
            <Plus className="w-3.5 h-3.5" /> {t("pricing.addBook")}
          </button>
        )}
        {error && <span className="text-xs text-er ml-auto">{error}</span>}
      </div>

      <DataTableShell
        tableId="inventory.pricing"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth={`${Math.max(780, 610 + books.length * 170)}px`}
        maxHeight="calc(100dvh - 430px)"
        fillHeight
      />
      {formulaRow && formulaBook && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
          onMouseDown={() => setFormula(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-left shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{t("pricing.formula.title")}</div>
                <div className="mt-1 truncate text-sm text-slate-500">{formulaRow.name} · {formulaBook.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setFormula(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 text-sm">
              {t("pricing.formula.newPrice")} <span className="font-bold text-primary-600">[{formatCurrency(computeNew(formulaRow, formulaBook.id))}]</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-slate-500">{t("pricing.formula.newPrice")} =</span>
              <Select
                value={fBase}
                onChange={(e) => setFBase(e.target.value as PriceFormulaBase)}
                size="sm"
                options={[
                  { value: "current", label: t("pricing.formula.baseCurrent") },
                  { value: "cost", label: t("pricing.formula.baseCost") },
                  { value: "lastPurchase", label: t("pricing.cols.lastPurchase") },
                ]}
              />
              <button type="button" onClick={() => setFOp("+")} className={cn("grid h-7 w-7 place-items-center rounded-full border text-sm", fOp === "+" ? "border-primary-600 bg-primary-600 text-white" : "border-border")}>+</button>
              <button type="button" onClick={() => setFOp("-")} className={cn("grid h-7 w-7 place-items-center rounded-full border text-sm", fOp === "-" ? "border-primary-600 bg-primary-600 text-white" : "border-border")}>−</button>
              <input type="number" min={0} value={fAmount || ""} onChange={(e) => setFAmount(Math.max(0, Number(e.target.value)))} className="no-spinner w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-right text-sm" />
              <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                <button type="button" onClick={() => setFUnit("vnd")} className={cn("px-2 py-1.5", fUnit === "vnd" ? "bg-primary-600 text-white" : "")}>VND</button>
                <button type="button" onClick={() => setFUnit("pct")} className={cn("px-2 py-1.5", fUnit === "pct" ? "bg-primary-600 text-white" : "")}>%</button>
              </div>
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={fAll} onChange={(e) => setFAll(e.target.checked)} className="mt-0.5" />
              <span>{t("pricing.formula.applyAll", { n: total })} <b>{formulaBook.name}</b></span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormula(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm">{t("common.cancel")}</button>
              <button type="button" onClick={() => applyFormula(formulaRow, formulaBook.id)} disabled={applying} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {applying && <Loader2 className="h-4 w-4 animate-spin" />} {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
