"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calculator, Check, ChevronDown, Loader2, Pencil, Plus, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { createPriceBook, renamePriceBook, deletePriceBook, setProductPrice, applyPriceFormulaAll, type PriceFormulaBase } from "@/lib/actions/price-books";
import { comparePriceBooks, isPriceBookReadOnly, isSystemPriceBook, systemPriceBookType, type SystemPriceBookType } from "@/lib/pricing/system-price-books";
import { reconcilePricingRows } from "./pricing-rows";

export interface PricingBook {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  systemType?: SystemPriceBookType | null;
  costBased?: boolean;
}
export interface PricingRow {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  costPrice: number | null;
  lastPurchase: number | null;
  prices: Record<string, number | null>;
}

type PriceEditorLabels = {
  formulaTitle: string;
  belowCost: string;
  noData: string;
};

function priceColumnWidth(book: PricingBook): number {
  switch (systemPriceBookType(book)) {
    case "cost": return 130;
    case "purchase": return 160;
    case "list": return 190;
    default: return 170;
  }
}

function PricingBookLabel({ book }: { book: PricingBook }) {
  const type = systemPriceBookType(book);
  const description = type === "purchase"
    ? "Đơn giá sau chiết khấu nhà cung cấp của lần nhập đã nhận gần nhất, chưa gồm thuế và phí."
    : type === "list"
      ? "Giá niêm yết công ty, dùng làm giá gốc để chiết khấu cho khách. Cập nhật độc lập với chiết khấu nhập hàng."
      : undefined;
  return description ? <span tabIndex={0} title={description} className="cursor-help underline decoration-dotted underline-offset-4">{book.name}</span> : book.name;
}

export function PriceBookEditor({
  row,
  book,
  defaultBookId,
  saving,
  saved,
  mobile = false,
  labels,
  onOpenFormula,
  onChange,
  onCommit,
}: {
  row: PricingRow;
  book: PricingBook;
  defaultBookId: string;
  saving: boolean;
  saved: boolean;
  mobile?: boolean;
  labels: PriceEditorLabels;
  onOpenFormula: () => void;
  onChange: (value: number | null) => void;
  onCommit: (value: number | null) => void;
}) {
  const value = row.prices[book.id];
  if (isPriceBookReadOnly(book)) {
    return (
      <span
        aria-label={book.name}
        className={cn("block py-2 text-sm tabular-nums", mobile ? "font-semibold" : "text-right", value == null && "text-slate-500")}
      >
        {value == null ? labels.noData : formatCurrency(value)}
      </span>
    );
  }
  const catalogue = systemPriceBookType(book) === "list";
  const fallback = !isSystemPriceBook(book) && book.id !== defaultBookId && value == null;
  const belowCost = row.costPrice != null && value != null && value > 0 && value < row.costPrice;

  return (
    <div
      className={cn(
        "relative flex min-w-0 items-center gap-2 group/cell",
        !mobile && "inline-flex gap-1",
      )}
      onClick={stopRowToggle}
    >
      <button
        type="button"
        onClick={onOpenFormula}
        title={labels.formulaTitle}
        aria-label={`${labels.formulaTitle}: ${book.name}`}
        className={cn(
          "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-slate-400 hover:text-primary-600",
          !mobile && "lg:min-h-0 lg:min-w-0 lg:p-1 lg:opacity-0 lg:group-hover/cell:opacity-100",
        )}
      >
        <Calculator className="h-3.5 w-3.5" />
      </button>
      <div className={cn("relative min-w-0", mobile ? "flex-1" : catalogue ? "w-32" : "w-28")}>
        <MoneyInput
          value={value ?? ""}
          placeholder={fallback ? formatCurrency(row.prices[defaultBookId] ?? 0) : catalogue ? labels.noData : "—"}
          onChange={onChange}
          onBlur={() => {
            const next = value == null
              ? (book.id === defaultBookId ? 0 : null)
              : Math.max(0, value);
            onCommit(next);
          }}
          className={cn(
            "w-full border bg-surface pl-7 text-right text-sm tabular-nums",
            mobile ? "rounded-lg pr-3" : "rounded-md py-1.5 pr-2",
            belowCost ? "border-red-400 text-er" : "border-slate-200 dark:border-slate-700",
            fallback && "text-slate-400",
          )}
          title={belowCost ? labels.belowCost : undefined}
          aria-label={book.name}
        />
        {/* Keep save feedback inside the field: table cells clip overflow. */}
        {(saving || saved) && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" aria-hidden="true">
            {saving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              : <Check className="h-3.5 w-3.5 text-ok" />}
          </span>
        )}
      </div>
    </div>
  );
}

export function PricingMobileRow({
  row,
  books,
  defaultBookId,
  savingCell,
  savedCell,
  labels,
  onOpenFormula,
  onPriceChange,
  onPriceCommit,
}: {
  row: PricingRow;
  books: PricingBook[];
  defaultBookId: string;
  savingCell: Set<string>;
  savedCell: Set<string>;
  labels: PriceEditorLabels;
  onOpenFormula: (rowId: string, bookId: string) => void;
  onPriceChange: (rowId: string, bookId: string, value: number | null) => void;
  onPriceCommit: (row: PricingRow, bookId: string, value: number | null) => void;
}) {
  return (
    <article className="min-w-0 p-4">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold">{row.name}</h3>
        <p className="mt-1 text-xs text-slate-500">{row.sku} · {row.baseUnit}</p>
      </div>
      <div className="mt-3 grid min-w-0 gap-3">
        {[...books].sort(comparePriceBooks).map((book) => {
          const key = `${row.id}:${book.id}`;
          return (
            <div key={book.id} className="min-w-0">
              <div className="mb-1.5 break-words text-xs font-semibold text-slate-600 dark:text-slate-300">
                <PricingBookLabel book={book} />
              </div>
              <PriceBookEditor
                row={row}
                book={book}
                defaultBookId={defaultBookId}
                saving={savingCell.has(key)}
                saved={savedCell.has(key)}
                mobile
                labels={labels}
                onOpenFormula={() => onOpenFormula(row.id, book.id)}
                onChange={(value) => onPriceChange(row.id, book.id, value)}
                onCommit={(value) => onPriceCommit(row, book.id, value)}
              />
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function PricingTable({ books: initialBooks, rows: initialRows, total, resetScrollKey, canViewPurchasePrices = false }: { books: PricingBook[]; rows: PricingRow[]; total: number; resetScrollKey?: string | number; canViewPurchasePrices?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [books, setBooks] = useState(() => [...initialBooks].sort(comparePriceBooks));
  const [rows, setRows] = useState(initialRows);
  const [previousRows, setPreviousRows] = useState(initialRows);
  const [error, setError] = useState("");
  const [savingCell, setSavingCell] = useState<Set<string>>(new Set());
  const [savedCell, setSavedCell] = useState<Set<string>>(new Set());
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string> | undefined>();

  // Revalidation must refresh prices without replacing the scroll container.
  // Keep edits in other cells if a save response arrives while the user types.
  if (previousRows !== initialRows) {
    setPreviousRows(initialRows);
    setRows(reconcilePricingRows(rows, previousRows, initialRows));
  }

  // popover "Đặt giá theo công thức"
  const [formula, setFormula] = useState<{ rowId: string; bookId: string } | null>(null);
  const [fBase, setFBase] = useState<PriceFormulaBase>("current");
  const [fOp, setFOp] = useState<"+" | "-">("+");
  const [fAmount, setFAmount] = useState(0);
  const [fUnit, setFUnit] = useState<"vnd" | "pct">("pct");
  const [fAll, setFAll] = useState(false);
  const [applying, setApplying] = useState(false);

  function openFormula(rowId: string, bookId: string) {
    const book = books.find((item) => item.id === bookId);
    if (!book || isPriceBookReadOnly(book)) return;
    setFBase("current"); setFOp("+"); setFAmount(0); setFUnit("pct"); setFAll(false);
    setFormula({ rowId, bookId });
  }
  function computeNew(row: PricingRow, bookId: string): number | null {
    if ((fBase === "cost" || fBase === "lastPurchase") && !canViewPurchasePrices) return null;
    const book = books.find((item) => item.id === bookId);
    const base = fBase === "cost" ? row.costPrice
      : fBase === "lastPurchase" ? row.lastPurchase
      : fBase === "list" ? row.prices[listBookId] ?? null
      : (row.prices[bookId] ?? (book && systemPriceBookType(book) === "list" ? null : row.prices[defaultBookId] ?? 0));
    if (base == null) return null;
    const delta = fUnit === "pct" ? (base * fAmount) / 100 : fAmount;
    return Math.max(0, Math.round(base + (fOp === "-" ? -delta : delta)));
  }
  async function applyFormula(row: PricingRow, bookId: string) {
    const book = books.find((item) => item.id === bookId);
    const nextPrice = computeNew(row, bookId);
    if (!book || isPriceBookReadOnly(book) || nextPrice == null) return;
    if (fAll) {
      setApplying(true); setError("");
      const res = await applyPriceFormulaAll({ priceBookId: bookId, base: fBase, op: fOp, amount: fAmount, unit: fUnit });
      setApplying(false);
      if (res.ok) { setFormula(null); router.refresh(); }
      else setError(t(res.error as never));
    } else {
      await saveCell(row, bookId, nextPrice);
      setFormula(null);
    }
  }

  // quản lý bảng giá
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<PricingBook | null>(null);
  const [deletingBook, setDeletingBook] = useState(false);
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const bookMenuRef = useRef<HTMLDivElement>(null);

  const defaultBookId = books.find((b) => b.isDefault)?.id ?? books[0]?.id ?? "";
  const listBookId = books.find((b) => systemPriceBookType(b) === "list")?.id ?? "";
  const cellKey = (rowId: string, bookId: string) => `${rowId}:${bookId}`;
  const formulaRow = formula ? rows.find((row) => row.id === formula.rowId) : null;
  const formulaBook = formula ? books.find((book) => book.id === formula.bookId) : null;

  useEffect(() => {
    if (!bookMenuOpen) return;

    function closeBookMenu(event: MouseEvent) {
      if (!bookMenuRef.current?.contains(event.target as Node)) setBookMenuOpen(false);
    }

    function closeBookMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setBookMenuOpen(false);
    }

    document.addEventListener("mousedown", closeBookMenu);
    document.addEventListener("keydown", closeBookMenuWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeBookMenu);
      document.removeEventListener("keydown", closeBookMenuWithKeyboard);
    };
  }, [bookMenuOpen]);

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
    const book = books.find((item) => item.id === id);
    if (!book || isSystemPriceBook(book)) return;
    setEditing(null);
    const n = name.trim();
    if (!n) return;
    setBooks((b) => b.map((x) => (x.id === id ? { ...x, name: n } : x)));
    const res = await renamePriceBook(id, n);
    if (!res.ok) setError(t(res.error as never));
  }

  async function removeBook(id: string) {
    const book = books.find((item) => item.id === id);
    if (!book || isSystemPriceBook(book)) return;
    setError("");
    const res = await deletePriceBook(id);
    if (res.ok) {
      setBooks((b) => b.filter((x) => x.id !== id));
      setRows((rs) => rs.map((r) => { const p = { ...r.prices }; delete p[id]; return { ...r, prices: p }; }));
      setDeleteCandidate(null);
    } else setError(t(res.error as never));
  }

  async function confirmRemoveBook() {
    if (!deleteCandidate) return;
    setDeletingBook(true);
    await removeBook(deleteCandidate.id);
    setDeletingBook(false);
  }

  async function saveCell(row: PricingRow, bookId: string, value: number | null) {
    const book = books.find((item) => item.id === bookId);
    if (!book || isPriceBookReadOnly(book)) return;
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

  function updateCell(rowId: string, bookId: string, value: number | null) {
    const book = books.find((item) => item.id === bookId);
    if (!book || isPriceBookReadOnly(book)) return;
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? { ...row, prices: { ...row.prices, [bookId]: value } }
          : row
      )
    );
  }

  const priceEditorLabels: PriceEditorLabels = {
    formulaTitle: t("pricing.formula.title"),
    belowCost: t("pricing.belowCost"),
    noData: t("dashboard.noData"),
  };

  const columns: DataTableColumn<PricingRow>[] = [
    {
      key: "product",
      label: t("orders.cols.product"),
      required: true,
      width: "280px",
      cellClassName: "whitespace-normal",
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-slate-400">{r.sku} · {r.baseUnit}</div>
        </div>
      ),
    },
    ...books.map((b): DataTableColumn<PricingRow> => ({
      key: `book:${b.id}`,
      label: <PricingBookLabel book={b} />,
      required: isSystemPriceBook(b),
      defaultVisible: isSystemPriceBook(b),
      align: "right",
      width: `${priceColumnWidth(b)}px`,
      render: (r) => {
        const k = cellKey(r.id, b.id);
        return (
          <PriceBookEditor
            row={r}
            book={b}
            defaultBookId={defaultBookId}
            saving={savingCell.has(k)}
            saved={savedCell.has(k)}
            labels={priceEditorLabels}
            onOpenFormula={() => openFormula(r.id, b.id)}
            onChange={(value) => updateCell(r.id, b.id, value)}
            onCommit={(value) => saveCell(r, b.id, value)}
          />
        );
      },
    })),
  ];
  const visibleBooks = books.filter(
    (book) => isSystemPriceBook(book) || visibleColumnKeys?.has(`book:${book.id}`),
  );

  function setBookVisible(bookId: string, visible: boolean) {
    const book = books.find((item) => item.id === bookId);
    if (!book || isSystemPriceBook(book)) return;
    const key = `book:${bookId}`;
    setVisibleColumnKeys((current) => {
      const next = new Set(
        current ?? columns
          .filter((column) => column.required || column.defaultVisible !== false)
          .map((column) => column.key),
      );
      if (visible) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="rounded-card border border-border bg-surface">
      {/* thanh quản lý bảng giá */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <div ref={bookMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={bookMenuOpen}
            onClick={() => setBookMenuOpen((open) => !open)}
            className="inline-flex min-h-11 min-w-44 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
          >
            <span>{t("pricing.booksLabel")} · {visibleBooks.length}</span>
            <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", bookMenuOpen && "rotate-180")} />
          </button>
          {bookMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-1.5 shadow-e2"
            >
              {books.map((b) => {
                const required = isSystemPriceBook(b);
                const visible = required || !!visibleColumnKeys?.has(`book:${b.id}`);
                return (
                  <div key={b.id} className="group flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-surface-2">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={visible}
                      aria-disabled={required}
                      disabled={required}
                      aria-label={t("pricing.bookVisibility", { name: b.name })}
                      title={t("pricing.bookVisibility", { name: b.name })}
                      onClick={() => setBookVisible(b.id, !visible)}
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors",
                        visible
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-slate-300 bg-surface text-transparent hover:border-primary-400",
                        required && "cursor-not-allowed opacity-70",
                        "min-h-11 lg:min-h-0 min-w-11 lg:min-w-0",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    {editing?.id === b.id ? (
                      <input
                        autoFocus
                        value={editing.name}
                        onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                        onBlur={() => rename(b.id, editing.name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") rename(b.id, editing.name);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="min-h-9 min-w-0 flex-1 rounded border border-primary-400 bg-surface px-2 text-sm min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={visible}
                          aria-disabled={required}
                          disabled={required}
                          onClick={() => setBookVisible(b.id, !visible)}
                          className={cn(
                            "min-w-0 flex-1 truncate text-left text-sm",
                            required && "cursor-default font-semibold",
                            "min-h-11 lg:min-h-0 min-w-11 lg:min-w-0",
                          )}
                        >
                          {b.name}
                        </button>
                        {!isSystemPriceBook(b) && <button
                          type="button"
                          onClick={() => setEditing({ id: b.id, name: b.name })}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-surface hover:text-primary-600 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
                          title={t("common.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>}
                        {!isSystemPriceBook(b) && (
                          <button
                            type="button"
                            onClick={() => {
                              setBookMenuOpen(false);
                              setDeleteCandidate(b);
                            }}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-surface hover:text-red-500 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
                            title={t("common.delete")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {creating ? (
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={addBook}
            onKeyDown={(e) => { if (e.key === "Enter") addBook(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            placeholder={t("pricing.newBookPlaceholder")}
            className="min-h-11 w-36 rounded-lg border border-primary-400 bg-surface px-2 text-sm"
          />
        ) : (
          <button onClick={() => setCreating(true)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-dashed border-border px-2.5 text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40 min-w-11">
            <Plus className="w-3.5 h-3.5" /> {t("pricing.addBook")}
          </button>
        )}
        {error && <span className="text-xs text-er ml-auto">{error}</span>}
      </div>

      <DataTableShell
        tableId="inventory.pricing"
        rows={rows}
        columns={columns}
        embedded
        visibleColumnKeys={visibleColumnKeys}
        onColumnVisibilityChange={setVisibleColumnKeys}
        getRowId={(row) => row.id}
        minWidth={`${Math.max(640, 280 + visibleBooks.reduce((sum, book) => sum + priceColumnWidth(book), 0))}px`}
        maxHeight="calc(100dvh - 340px)"
        fillHeight
        resetScrollKey={resetScrollKey}
        renderMobileRow={({ row }) => (
          <PricingMobileRow
            row={row}
            books={visibleBooks}
            defaultBookId={defaultBookId}
            savingCell={savingCell}
            savedCell={savedCell}
            labels={priceEditorLabels}
            onOpenFormula={openFormula}
            onPriceChange={updateCell}
            onPriceCommit={saveCell}
          />
        )}
      />
      {deleteCandidate && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
          onMouseDown={() => !deletingBook && setDeleteCandidate(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-price-book-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-left shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div id="delete-price-book-title" className="font-semibold">{t("pricing.deleteBook.title")}</div>
                <p className="mt-1 text-sm text-slate-500">{t("pricing.deleteBook.description", { name: deleteCandidate.name })}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                disabled={deletingBook}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 disabled:opacity-50 lg:h-8 lg:w-8"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteCandidate(null)} disabled={deletingBook} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-50 min-w-11 lg:min-w-0">{t("common.cancel")}</button>
              <button type="button" onClick={confirmRemoveBook} disabled={deletingBook} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 min-w-11 lg:min-w-0">
                {deletingBook && <Loader2 className="h-4 w-4 animate-spin" />} {t("pricing.deleteBook.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
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
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 lg:h-8 lg:w-8"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 text-sm">
              {t("pricing.formula.newPrice")} <span className="font-bold text-primary-600">[{computeNew(formulaRow, formulaBook.id) == null ? priceEditorLabels.noData : formatCurrency(computeNew(formulaRow, formulaBook.id)!)}]</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-slate-500">{t("pricing.formula.newPrice")} =</span>
              <Select
                value={fBase}
                onChange={(e) => setFBase(e.target.value as PriceFormulaBase)}
                size="sm"
                menuMinWidth={240}
                wrapLabel
                options={[
                  { value: "current", label: t("pricing.formula.baseCurrent") },
                  ...(listBookId ? [{ value: "list", label: books.find((book) => book.id === listBookId)!.name }] : []),
                  ...(canViewPurchasePrices ? [
                    { value: "cost", label: t("pricing.formula.baseCost") },
                    { value: "lastPurchase", label: books.find((book) => book.systemType === "purchase")?.name ?? "Giá nhập cuối" },
                  ] : []),
                ]}
              />
              <button type="button" onClick={() => setFOp("+")} className={cn("grid h-11 w-11 place-items-center rounded-full border text-sm lg:h-7 lg:w-7", fOp === "+" ? "border-primary-600 bg-primary-600 text-white" : "border-border")}>+</button>
              <button type="button" onClick={() => setFOp("-")} className={cn("grid h-11 w-11 place-items-center rounded-full border text-sm lg:h-7 lg:w-7", fOp === "-" ? "border-primary-600 bg-primary-600 text-white" : "border-border")}>−</button>
              <NumberInput min={0} value={fAmount} onChange={(value) => setFAmount(value ?? 0)} thousandSeparator={fUnit === "vnd"} suffix={fUnit === "pct" ? "%" : undefined} className="min-h-11 w-20 rounded-md px-2 text-right text-sm" />
              <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
                <button type="button" onClick={() => setFUnit("vnd")} className={cn("min-h-11 min-w-11 px-2 lg:min-h-0 lg:min-w-0 lg:py-1.5", fUnit === "vnd" ? "bg-primary-600 text-white" : "")}>VND</button>
                <button type="button" onClick={() => setFUnit("pct")} className={cn("min-h-11 min-w-11 px-2 lg:min-h-0 lg:min-w-0 lg:py-1.5", fUnit === "pct" ? "bg-primary-600 text-white" : "")}>%</button>
              </div>
            </div>
            <label className="mt-4 flex min-h-11 min-w-11 items-start gap-2 text-sm lg:min-h-0 lg:min-w-0">
              <Checkbox checked={fAll} onChange={(e) => setFAll(e.target.checked)} className="mt-0.5" />
              <span>{t("pricing.formula.applyAll", { n: total })} <b>{formulaBook.name}</b></span>
            </label>
            {fAll && <p className="mt-1 text-xs text-slate-500">Chỉ áp dụng cho sản phẩm có giá nền.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFormula(null)} className="min-h-11 rounded-lg border border-border px-3 text-sm min-w-11">{t("common.cancel")}</button>
              <button type="button" onClick={() => applyFormula(formulaRow, formulaBook.id)} disabled={applying || computeNew(formulaRow, formulaBook.id) == null} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white disabled:opacity-50 min-w-11">
                {applying && <Loader2 className="h-4 w-4 animate-spin" />} {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
