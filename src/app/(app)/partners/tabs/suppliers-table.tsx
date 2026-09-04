"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Truck, X } from "lucide-react";
import { DataTableShell, RowPreviewModal, type DataTableColumn } from "@/components/data-table";
import { FilterTriggerButton, ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getSuppliers } from "@/lib/data/partners";
import { updateSupplier } from "@/lib/actions/partners";
import { SupplierQuickCreate } from "../../suppliers/supplier-form";
import { SupplierPayableActions } from "@/components/partners/supplier-payable-actions";
import { useAppDataQuery } from "@/components/use-app-data-query";
import {
  DEFAULT_PARTNER_DEBT_FILTER,
  PartnerDebtFilterControl,
  matchesPartnerDebtFilter,
} from "@/components/partners/partner-debt-filter";

type SupplierRow = Awaited<ReturnType<typeof getSuppliers>>["rows"][number];
type SupplierDetailTab = "info" | "history" | "debt";
type SupplierPreview = {
  supplier: {
    id: string;
    code: string | null;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    taxCode: string | null;
    currentDebt: string;
    note: string | null;
    createdAt: string;
  };
  purchases: Array<{
    id: string;
    code: string;
    status: string;
    total: string;
    amountPaid: string;
    createdAt: string;
    itemCount: number;
  }>;
  purchaseReturns: Array<{
    id: string;
    code: string;
    status: string;
    settlementStatus: string;
    totalRefund: string;
    refundAmount: string;
    debtAmount: string;
    createdAt: string;
  }>;
  payables: {
    currentDebt: number;
    lastReconciledAt: string | null;
    invoices: Array<{ id: string; code: string; createdAt: string; total: number; amountPaid: number; remaining: number }>;
    ledger: SupplierDebtRow[];
  } | null;
};
type SupplierHistoryRow = {
  id: string;
  kind: "purchase" | "return";
  code: string;
  createdAt: string;
  total: number;
  debtChange: number;
  itemCount?: number;
  status: string;
};
type SupplierDraft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string;
  note: string;
};
type SupplierDebtRow = {
  id: string;
  kind: "purchase" | "return" | "payment" | "adjustment";
  code: string;
  purchaseOrderId: string | null;
  createdAt: string;
  typeLabel: string;
  value: number;
  balance: number;
  reason: string | null;
};

const DETAIL_TABS: SupplierDetailTab[] = ["info", "history", "debt"];
type SupplierDebtFilter = "" | "owing" | "clear";

async function loadSupplierPreview(id: string, signal: AbortSignal): Promise<SupplierPreview> {
  const response = await fetch(`/api/suppliers/${encodeURIComponent(id)}/preview`, { cache: "no-store", signal });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error("errors.serverError");
  return payload.data as SupplierPreview;
}

export function SuppliersTable({
  rows,
  query,
  owing,
  pageSize,
  initialDetailId = null,
  initialDetailSupplier = null,
}: {
  rows: SupplierRow[];
  query: string;
  owing: SupplierDebtFilter;
  pageSize: number;
  initialDetailId?: string | null;
  initialDetailSupplier?: SupplierRow | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftDebtFilter, setDraftDebtFilter] = useState<SupplierDebtFilter>(owing);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(initialDetailId);
  const selectedSupplier = rows.find((row) => row.id === selectedSupplierId)
    ?? (initialDetailSupplier?.id === selectedSupplierId ? initialDetailSupplier : null);
  const { state: preview, refresh: refreshPreview } = useAppDataQuery(selectedSupplier?.id ?? null, loadSupplierPreview);
  const [draft, setDraft] = useState<SupplierDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!filterOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filterOpen]);

  function openFilters() {
    setDraftDebtFilter(owing);
    setFilterOpen(true);
  }

  function applyDebtFilter(value: SupplierDebtFilter) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "suppliers");
    next.set("size", String(pageSize));
    next.delete("page");
    if (value) next.set("owing", value);
    else next.delete("owing");
    router.replace(`${Routes.Partners}?${next.toString()}`, { scroll: false });
    setFilterOpen(false);
  }
  const columns: DataTableColumn<SupplierRow>[] = [
    { key: "name", label: t("suppliers.cols.name"), required: true, render: (row) => <PartnerDetailLink kind="supplier" partnerId={row.id} name={row.name} className="font-semibold" /> },
    { key: "code", label: t("customers.cols.code"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.code}</span> },
    { key: "phone", label: t("customers.cols.phone"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.phone ?? "—"}</span> },
    { key: "tax", label: t("customers.fields.taxCode"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.taxCode ?? "—"}</span> },
    {
      key: "debt",
      label: t("suppliers.cols.debt"),
      defaultVisible: true,
      align: "right",
      cellClassName: (row) => Number(row.currentDebt) > 0 ? "font-semibold text-warn" : "text-slate-400",
      render: (row) => Number(row.currentDebt) > 0 ? formatCurrency(Number(row.currentDebt)) : "—",
    },
  ];

  function openSupplier(row: SupplierRow) {
    setSelectedSupplierId(row.id);
    setEditing(false);
    setSaving(false);
    setSaveError("");
    setDraft(null);
  }

  function closeSupplier() {
    setSelectedSupplierId(null);
    if (searchParams.has("detailSupplierId")) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("detailSupplierId");
      router.replace(`${Routes.Partners}?${next.toString()}`, { scroll: false });
    }
    setDraft(null);
    setEditing(false);
    setSaving(false);
    setSaveError("");
  }

  function startEditing() {
    if (!preview?.data) return;
    setDraft(toSupplierDraft(preview.data.supplier));
    setSaveError("");
    setEditing(true);
  }

  function cancelEditing() {
    if (preview?.data) setDraft(toSupplierDraft(preview.data.supplier));
    setSaveError("");
    setEditing(false);
  }

  async function saveSupplier() {
    if (!preview?.data || !draft || saving) return;
    if (!draft.name.trim()) {
      setSaveError(t("validation.required"));
      return;
    }

    setSaving(true);
    setSaveError("");
    const result = await updateSupplier({
      id: preview.data.supplier.id,
      name: draft.name.trim(),
      phone: draft.phone,
      email: draft.email,
      address: draft.address,
      taxCode: draft.taxCode,
      note: draft.note,
    });
    setSaving(false);

    if (!result.ok) {
      setSaveError(t(result.error as never));
      return;
    }

    setEditing(false);
    await refreshPreview();
    router.refresh();
  }

  async function refreshSelectedSupplier() {
    await refreshPreview();
    router.refresh();
  }

  return (
    <>
      <DataTableShell
        tableId="partners.suppliers"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth="860px"
        empty={(
          <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
            <Truck className="mx-auto mb-3 h-10 w-10 opacity-60" />
            <p className="font-medium">{t("suppliers.empty")}</p>
          </div>
        )}
        toolbar={(
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
            <ListSearchFilterBar
              search={(
                <InstantFilterForm action={Routes.Partners}>
                  <input type="hidden" name="tab" value="suppliers" />
                  <input type="hidden" name="size" value={pageSize} />
                  {owing && <input type="hidden" name="owing" value={owing} />}
                  <ListSearchInput
                    name="q"
                    defaultValue={query}
                    placeholder={t("suppliers.searchPlaceholder")}
                    aria-label={t("common.search")}
                  />
                </InstantFilterForm>
              )}
              filter={(
                <FilterTriggerButton
                  onClick={openFilters}
                  label={t("suppliers.filter.button")}
                  active={Boolean(owing)}
                  hideLabelOnSmallScreens
                />
              )}
            />
            <div className="shrink-0">
              <SupplierQuickCreate />
            </div>
          </div>
        )}
        onRowClick={openSupplier}
        renderMobileRow={({ row }) => {
          const debt = Number(row.currentDebt);
          return (
            <article className="w-full p-3 text-left min-h-11">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold"><PartnerDetailLink kind="supplier" partnerId={row.id} name={row.name} /></div>
                  <button type="button" onClick={() => openSupplier(row)} className="inline-flex min-h-11 min-w-11 items-center text-xs text-slate-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{row.phone ?? row.code ?? t("suppliers.title")}</button>
                </div>
                {debt > 0 ? <span className="shrink-0 text-sm font-semibold tabular-nums text-warn">{formatCurrency(debt)}</span> : <span className="text-slate-300">—</span>}
              </div>
            </article>
          );
        }}
      />

      {filterOpen && (
        <div
          className="fixed inset-0 z-[80] bg-slate-950/40"
          role="presentation"
          onMouseDown={() => setFilterOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-filter-title"
            className="ml-auto flex h-full w-full max-w-md flex-col bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start border-b border-border px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2
                  id="supplier-filter-title"
                  className="text-lg font-extrabold text-slate-900 dark:text-slate-100"
                >
                  {t("suppliers.filter.title")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("suppliers.filter.description")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                aria-label={t("common.close")}
                className="ml-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                {t("suppliers.filter.debtStatus")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ["", t("suppliers.filter.allDebt")],
                  ["owing", t("suppliers.filter.owing")],
                  ["clear", t("suppliers.filter.clear")],
                ] as const).map(([value, label]) => (
                  <button
                    key={value || "all"}
                    type="button"
                    aria-pressed={draftDebtFilter === value}
                    onClick={() => setDraftDebtFilter(value)}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 items-center rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                      draftDebtFilter === value
                        ? "border-primary-600 bg-primary-600 text-white"
                        : "border-border bg-surface text-slate-600 hover:bg-surface-2",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setDraftDebtFilter("")}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border px-4 text-sm font-bold text-slate-600 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0"
              >
                {t("suppliers.filter.reset")}
              </button>
              <button
                type="button"
                onClick={() => applyDebtFilter(draftDebtFilter)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-bold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0"
              >
                {t("suppliers.filter.apply")}
              </button>
            </div>
          </aside>
        </div>
      )}

      <RowPreviewModal
        open={Boolean(selectedSupplierId)}
        onClose={closeSupplier}
        title={preview?.data?.supplier.name ?? selectedSupplier?.name ?? t("suppliers.title")}
        subtitle={selectedSupplier ? `${preview?.data?.supplier.code ?? selectedSupplier.code ?? "—"} · ${t("suppliers.cols.debt")}: ${formatCurrency(Number(preview?.data?.supplier.currentDebt ?? selectedSupplier.currentDebt))}` : undefined}
        closeLabel={t("common.close")}
        bodyClassName="flex flex-col !overflow-hidden"
        footer={preview?.data && (
          <div className="flex justify-end gap-2">
            {editing ? (
              <>
                <button type="button" onClick={cancelEditing} disabled={saving} className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-surface-2 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
                  {t("common.cancel")}
                </button>
                <button type="button" onClick={saveSupplier} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("common.save")}
                </button>
              </>
            ) : (
              <button type="button" onClick={startEditing} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-primary-600 hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
                <Pencil className="h-4 w-4" />
                {t("common.edit")}
              </button>
            )}
          </div>
        )}
      >
        {!selectedSupplier ? <div className="p-8 text-center text-sm text-slate-500">{t("errors.notFound")}</div> : preview?.loading ? (
          <div className="grid min-h-64 place-items-center text-sm font-semibold text-slate-500">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</span>
          </div>
        ) : preview?.error ? (
          <div className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-er">{t(preview.error as never)}</div>
        ) : preview?.data ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{saveError}</div>}
            <SupplierDetailTabs
              preview={preview.data}
              draft={draft ?? toSupplierDraft(preview.data.supplier)}
              editing={editing}
              onDraftChange={(field, value) => setDraft((current) => current ? { ...current, [field]: value } : current)}
              onPayablesChanged={refreshSelectedSupplier}
            />
          </div>
        ) : null}
      </RowPreviewModal>
    </>
  );
}

function SupplierDetailTabs({
  preview,
  draft,
  editing,
  onDraftChange,
  onPayablesChanged,
}: {
  preview: SupplierPreview;
  draft: SupplierDraft;
  editing: boolean;
  onDraftChange: (field: keyof SupplierDraft, value: string) => void;
  onPayablesChanged: () => void | Promise<void>;
}) {
  const t = useTranslations();
  const [tab, setTab] = useState<SupplierDetailTab>("info");
  const visibleTab: SupplierDetailTab = editing ? "info" : tab;

  const history: SupplierHistoryRow[] = [
    ...preview.purchases.map((purchase) => ({
      id: purchase.id,
      kind: "purchase" as const,
      code: purchase.code,
      createdAt: purchase.createdAt,
      total: Number(purchase.total),
      debtChange: ["cancelled", "draft"].includes(purchase.status) ? 0 : Math.max(0, Number(purchase.total) - Number(purchase.amountPaid)),
      itemCount: purchase.itemCount,
      status: purchase.status,
    })),
    ...preview.purchaseReturns.map((purchaseReturn) => ({
      id: purchaseReturn.id,
      kind: "return" as const,
      code: purchaseReturn.code,
      createdAt: purchaseReturn.createdAt,
      total: Number(purchaseReturn.totalRefund),
      debtChange: purchaseReturn.status === "completed" ? -Number(purchaseReturn.debtAmount) : 0,
      status: purchaseReturn.status,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const debtRows: SupplierDebtRow[] = preview.payables?.ledger ?? history
    .filter((row) => row.debtChange !== 0)
    .reduce<{ balance: number; rows: SupplierDebtRow[] }>(
      (state, row) => ({
        balance: state.balance - row.debtChange,
        rows: [...state.rows, {
          id: row.id,
          kind: row.kind,
          code: row.code,
          purchaseOrderId: row.kind === "purchase" ? row.id : null,
          createdAt: row.createdAt,
          typeLabel: row.kind === "purchase" ? "Nhập hàng" : "Trả hàng",
          value: row.debtChange,
          balance: state.balance,
          reason: null,
        }],
      }),
      { balance: Number(preview.supplier.currentDebt), rows: [] },
    ).rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-6 overflow-x-auto overscroll-x-contain border-b border-border-soft text-sm font-semibold text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DETAIL_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { if (!editing || key === "info") setTab(key); }}
            disabled={editing && key !== "info"}
            className={cn(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 px-2 transition-colors lg:min-h-0 lg:min-w-0 lg:pb-2",
              visibleTab === key ? "border-primary-600 text-primary-600" : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
              editing && key !== "info" && "cursor-not-allowed opacity-40",
            )}
          >
            {t(`suppliers.details.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden pt-4">
        {visibleTab === "info" && <SupplierInfoPanel supplier={preview.supplier} draft={draft} editing={editing} onDraftChange={onDraftChange} />}
        {visibleTab === "history" && <SupplierHistoryPanel rows={history} />}
        {visibleTab === "debt" && <SupplierDebtPanel preview={preview} rows={debtRows} onPayablesChanged={onPayablesChanged} />}
      </div>
    </div>
  );
}

function SupplierInfoPanel({
  supplier,
  draft,
  editing,
  onDraftChange,
}: {
  supplier: SupplierPreview["supplier"];
  draft: SupplierDraft;
  editing: boolean;
  onDraftChange: (field: keyof SupplierDraft, value: string) => void;
}) {
  const t = useTranslations();
  const inputClassName = "h-10 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary-500 focus:outline-none lg:min-h-0";
  const labelClassName = "mb-1.5 block text-xs font-semibold text-slate-500";

  return (
    <div className="h-full space-y-5 overflow-auto pr-1">
      {editing ? (
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          <label>
            <span className={labelClassName}>{t("suppliers.cols.name")}</span>
            <input autoFocus className={inputClassName} value={draft.name} onChange={(event) => onDraftChange("name", event.target.value)} />
          </label>
          <Info label={t("customers.cols.code")} value={supplier.code ?? "—"} />
          <label>
            <span className={labelClassName}>{t("customers.cols.phone")}</span>
            <input className={inputClassName} value={draft.phone} onChange={(event) => onDraftChange("phone", event.target.value)} />
          </label>
          <label>
            <span className={labelClassName}>Email</span>
            <input type="email" className={inputClassName} value={draft.email} onChange={(event) => onDraftChange("email", event.target.value)} />
          </label>
          <label>
            <span className={labelClassName}>{t("customers.fields.address")}</span>
            <input className={inputClassName} value={draft.address} onChange={(event) => onDraftChange("address", event.target.value)} />
          </label>
          <label>
            <span className={labelClassName}>{t("customers.fields.taxCode")}</span>
            <input className={inputClassName} value={draft.taxCode} onChange={(event) => onDraftChange("taxCode", event.target.value)} />
          </label>
          <label className="md:col-span-2">
            <span className={labelClassName}>{t("customers.fields.note")}</span>
            <textarea className={cn(inputClassName, "min-h-24 resize-y py-2")} value={draft.note} onChange={(event) => onDraftChange("note", event.target.value)} />
          </label>
          <Info label={t("suppliers.details.createdAt")} value={formatDate(supplier.createdAt)} />
        </div>
      ) : (
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          <Info label={t("suppliers.cols.name")} value={supplier.name} />
          <Info label={t("customers.cols.code")} value={supplier.code ?? "—"} />
          <Info label={t("customers.cols.phone")} value={supplier.phone ?? "—"} />
          <Info label="Email" value={supplier.email ?? "—"} />
          <Info label={t("customers.fields.address")} value={supplier.address ?? "—"} />
          <Info label={t("customers.fields.taxCode")} value={supplier.taxCode ?? "—"} />
          <Info label={t("customers.fields.note")} value={supplier.note ?? "—"} />
          <Info label={t("suppliers.details.createdAt")} value={formatDate(supplier.createdAt)} />
        </div>
      )}
      <div className="rounded-card border border-warn/20 bg-warn-soft px-4 py-3">
        <div className="text-xs font-semibold text-warn">{t("suppliers.cols.debt")}</div>
        <div className="mt-1 text-xl font-bold tabular-nums text-warn">{formatCurrency(Number(supplier.currentDebt))}</div>
      </div>
    </div>
  );
}

function toSupplierDraft(supplier: SupplierPreview["supplier"]): SupplierDraft {
  return {
    name: supplier.name,
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    taxCode: supplier.taxCode ?? "",
    note: supplier.note ?? "",
  };
}

function SupplierHistoryPanel({ rows }: { rows: SupplierHistoryRow[] }) {
  const t = useTranslations();
  if (rows.length === 0) return <div className="h-full overflow-auto"><EmptyPanel message={t("suppliers.details.emptyHistory")} /></div>;

  return (
    <>
    <div className="h-full divide-y divide-border-soft overflow-auto rounded-card border border-border-soft lg:hidden" data-mobile-audit="supplier-history">
      {rows.map((row) => (
        <article key={`${row.kind}-${row.id}`} className="space-y-2 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={row.kind === "purchase" ? Routes.purchase(row.id) : `${Routes.PurchaseReturns}?q=${encodeURIComponent(row.code)}`}
              className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {row.code}
            </Link>
            <SupplierHistoryStatus row={row} />
          </div>
          <div className="text-xs text-slate-500">{formatDate(row.createdAt)} · {t(`suppliers.details.types.${row.kind}`)}</div>
          <div className="flex items-end justify-between gap-3">
            <span className="text-xs text-slate-500">{t("suppliers.details.historyCols.items")}: {row.itemCount ?? "—"}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(row.total)}</span>
          </div>
        </article>
      ))}
    </div>
    <div className="hidden h-full overscroll-contain overflow-auto rounded-card border border-border-soft lg:block">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
            <th className="px-3 py-3">{t("suppliers.details.historyCols.code")}</th>
            <th className="px-3 py-3">{t("suppliers.details.historyCols.time")}</th>
            <th className="px-3 py-3">{t("suppliers.details.historyCols.type")}</th>
            <th className="px-3 py-3 text-right">{t("suppliers.details.historyCols.items")}</th>
            <th className="px-3 py-3 text-right">{t("suppliers.details.historyCols.total")}</th>
            <th className="px-3 py-3">{t("suppliers.details.historyCols.status")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.id}`} className="hover:bg-surface-2">
              <td className="px-3 py-3 font-semibold">
                <Link href={row.kind === "purchase" ? Routes.purchase(row.id) : `${Routes.PurchaseReturns}?q=${encodeURIComponent(row.code)}`} className="text-primary-600 hover:underline">
                  {row.code}
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
              <td className="px-3 py-3">{t(`suppliers.details.types.${row.kind}`)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-500">{row.itemCount ?? "—"}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(row.total)}</td>
              <td className="px-3 py-3"><SupplierHistoryStatus row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function SupplierDebtPanel({ preview, rows, onPayablesChanged }: { preview: SupplierPreview; rows: SupplierDebtRow[]; onPayablesChanged: () => void | Promise<void> }) {
  const t = useTranslations();
  const [filter, setFilter] = useState(DEFAULT_PARTNER_DEBT_FILTER);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesPartnerDebtFilter(row, filter)),
    [filter, rows],
  );
  const currentDebt = preview.payables?.currentDebt ?? Number(preview.supplier.currentDebt);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        {preview.payables && (
          <div className="flex flex-wrap gap-2">
            <SupplierPayableActions
              supplierId={preview.supplier.id}
              overview={preview.payables}
              onChanged={onPayablesChanged}
            />
          </div>
        )}
        <div className="rounded-lg bg-warn-soft px-4 py-2 text-right">
          <div className="text-xs font-semibold text-warn">{t("suppliers.details.currentDebt")}</div>
          <div className="font-bold tabular-nums text-warn">{formatCurrency(currentDebt)}</div>
        </div>
      </div>
      <PartnerDebtFilterControl value={filter} onChange={setFilter} />
      {visibleRows.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto"><EmptyPanel message={t("suppliers.details.emptyDebt")} /></div>
      ) : (
        <>
        <div className="min-h-0 flex-1 divide-y divide-border-soft overflow-auto rounded-card border border-border-soft lg:hidden" data-mobile-audit="supplier-debt">
          {visibleRows.map((row) => (
            <article key={`${row.kind}-${row.id}`} className="space-y-2 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {row.purchaseOrderId ? <Link href={Routes.purchase(row.purchaseOrderId)} className="font-semibold text-primary-600 hover:underline min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 inline-flex">{row.code}</Link> : <div className="font-semibold text-primary-600 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">{row.code}</div>}
                  <div className="mt-0.5 text-xs text-slate-500">{formatDate(row.createdAt)} · {row.typeLabel}{row.reason ? ` · ${row.reason}` : ""}</div>
                </div>
                <div className={cn("shrink-0 font-semibold tabular-nums", row.value < 0 ? "text-ok" : "text-warn")}>
                  {row.value > 0 ? "+" : "−"}{formatCurrency(Math.abs(row.value))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-2 text-xs">
                <span className="text-slate-500">{t("suppliers.details.debtCols.balance")}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(row.balance)}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden min-h-0 flex-1 overscroll-contain overflow-auto rounded-card border border-border-soft lg:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                <th className="px-3 py-3">{t("suppliers.details.debtCols.code")}</th>
                <th className="px-3 py-3">{t("suppliers.details.debtCols.time")}</th>
                <th className="px-3 py-3">{t("suppliers.details.debtCols.type")}</th>
                <th className="px-3 py-3 text-right">{t("suppliers.details.debtCols.change")}</th>
                <th className="px-3 py-3 text-right">{t("suppliers.details.debtCols.balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {visibleRows.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td className="px-3 py-3 font-semibold text-primary-600">{row.purchaseOrderId ? <Link href={Routes.purchase(row.purchaseOrderId)} className="hover:underline">{row.code}</Link> : row.code}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-3">{row.typeLabel}{row.reason ? <div className="text-xs text-slate-500">{row.reason}</div> : null}</td>
                  <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", row.value < 0 ? "text-ok" : "text-warn")}>
                    {row.value > 0 ? "+" : "−"}{formatCurrency(Math.abs(row.value))}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function SupplierHistoryStatus({ row }: { row: SupplierHistoryRow }) {
  const t = useTranslations();
  const label = row.kind === "purchase"
    ? t(`purchases.status.${row.status}` as never)
    : t(`purchaseReturns.status.${row.status}` as never);
  return (
    <span className={cn(
      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
      ["cancelled", "draft"].includes(row.status) ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok",
    )}>
      {label}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 min-h-6 text-sm font-medium">{value}</div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-slate-400">
      {message}
    </div>
  );
}
