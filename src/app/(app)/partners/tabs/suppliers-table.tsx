"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { DataTableShell, RowPreviewModal, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getSuppliers } from "@/lib/data/partners";

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

const DETAIL_TABS: SupplierDetailTab[] = ["info", "history", "debt"];

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  const t = useTranslations();
  const requestId = useRef(0);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRow | null>(null);
  const [preview, setPreview] = useState<{ loading: boolean; data?: SupplierPreview; error?: string } | null>(null);
  const columns: DataTableColumn<SupplierRow>[] = [
    { key: "name", label: t("suppliers.cols.name"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.name}</span> },
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

  async function openSupplier(row: SupplierRow) {
    const currentRequest = ++requestId.current;
    setSelectedSupplier(row);
    setPreview({ loading: true });
    try {
      const response = await fetch(`/api/suppliers/${encodeURIComponent(row.id)}/preview`, { cache: "no-store" });
      const json = await response.json();
      if (currentRequest !== requestId.current) return;
      if (!response.ok || !json.ok) {
        setPreview({ loading: false, error: t("errors.serverError" as never) });
        return;
      }
      setPreview({ loading: false, data: json.data as SupplierPreview });
    } catch {
      if (currentRequest === requestId.current) {
        setPreview({ loading: false, error: t("errors.serverError" as never) });
      }
    }
  }

  function closeSupplier() {
    requestId.current += 1;
    setSelectedSupplier(null);
    setPreview(null);
  }

  return (
    <>
      <DataTableShell
        tableId="partners.suppliers"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth="860px"
        onRowClick={openSupplier}
        renderMobileRow={({ row }) => {
          const debt = Number(row.currentDebt);
          return (
            <button type="button" onClick={() => openSupplier(row)} className="w-full p-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{row.name}</div>
                  <div className="text-xs text-slate-400">{row.phone ?? row.code}</div>
                </div>
                {debt > 0 ? <span className="shrink-0 text-sm font-semibold tabular-nums text-warn">{formatCurrency(debt)}</span> : <span className="text-slate-300">—</span>}
              </div>
            </button>
          );
        }}
      />

      <RowPreviewModal
        open={Boolean(selectedSupplier)}
        onClose={closeSupplier}
        title={selectedSupplier?.name ?? t("suppliers.title")}
        subtitle={selectedSupplier ? `${selectedSupplier.code ?? "—"} · ${t("suppliers.cols.debt")}: ${formatCurrency(Number(selectedSupplier.currentDebt))}` : undefined}
        closeLabel={t("common.close")}
        footer={selectedSupplier && (
          <div className="flex justify-end">
            <Link href={Routes.supplier(selectedSupplier.id)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-primary-600 hover:bg-surface-2">
              <ExternalLink className="h-4 w-4" />
              {t("suppliers.details.openEdit")}
            </Link>
          </div>
        )}
      >
        {preview?.loading ? (
          <div className="grid min-h-64 place-items-center text-sm font-semibold text-slate-500">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</span>
          </div>
        ) : preview?.error ? (
          <div className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-er">{preview.error}</div>
        ) : preview?.data ? (
          <SupplierDetailTabs preview={preview.data} />
        ) : null}
      </RowPreviewModal>
    </>
  );
}

function SupplierDetailTabs({ preview }: { preview: SupplierPreview }) {
  const t = useTranslations();
  const [tab, setTab] = useState<SupplierDetailTab>("info");

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

  const debtRows = history
    .filter((row) => row.debtChange !== 0)
    .reduce<{ balance: number; rows: Array<SupplierHistoryRow & { balanceAfter: number }> }>(
      (state, row) => ({
        balance: state.balance - row.debtChange,
        rows: [...state.rows, { ...row, balanceAfter: state.balance }],
      }),
      { balance: Number(preview.supplier.currentDebt), rows: [] },
    ).rows;

  return (
    <div>
      <div className="flex items-center gap-6 overflow-x-auto border-b border-border-soft text-sm font-semibold text-slate-500">
        {DETAIL_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "shrink-0 border-b-2 pb-2 transition-colors",
              tab === key ? "border-primary-600 text-primary-600" : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`suppliers.details.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "info" && <SupplierInfoPanel supplier={preview.supplier} />}
        {tab === "history" && <SupplierHistoryPanel rows={history} />}
        {tab === "debt" && <SupplierDebtPanel rows={debtRows} currentDebt={Number(preview.supplier.currentDebt)} />}
      </div>
    </div>
  );
}

function SupplierInfoPanel({ supplier }: { supplier: SupplierPreview["supplier"] }) {
  const t = useTranslations();
  return (
    <div className="space-y-5">
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
      <div className="rounded-card border border-warn/20 bg-warn-soft px-4 py-3">
        <div className="text-xs font-semibold text-warn">{t("suppliers.cols.debt")}</div>
        <div className="mt-1 text-xl font-bold tabular-nums text-warn">{formatCurrency(Number(supplier.currentDebt))}</div>
      </div>
    </div>
  );
}

function SupplierHistoryPanel({ rows }: { rows: SupplierHistoryRow[] }) {
  const t = useTranslations();
  if (rows.length === 0) return <EmptyPanel message={t("suppliers.details.emptyHistory")} />;

  return (
    <div className="overflow-x-auto rounded-card border border-border-soft">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
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
  );
}

function SupplierDebtPanel({ rows, currentDebt }: { rows: Array<SupplierHistoryRow & { balanceAfter: number }>; currentDebt: number }) {
  const t = useTranslations();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="rounded-lg bg-warn-soft px-4 py-2 text-right">
          <div className="text-xs font-semibold text-warn">{t("suppliers.details.currentDebt")}</div>
          <div className="font-bold tabular-nums text-warn">{formatCurrency(currentDebt)}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyPanel message={t("suppliers.details.emptyDebt")} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-soft">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                <th className="px-3 py-3">{t("suppliers.details.debtCols.code")}</th>
                <th className="px-3 py-3">{t("suppliers.details.debtCols.time")}</th>
                <th className="px-3 py-3">{t("suppliers.details.debtCols.type")}</th>
                <th className="px-3 py-3 text-right">{t("suppliers.details.debtCols.change")}</th>
                <th className="px-3 py-3 text-right">{t("suppliers.details.debtCols.balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td className="px-3 py-3 font-semibold text-primary-600">{row.code}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-3">{t(`suppliers.details.debtTypes.${row.kind}`)}</td>
                  <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", row.debtChange < 0 ? "text-ok" : "text-warn")}>
                    {row.debtChange > 0 ? "+" : "−"}{formatCurrency(Math.abs(row.debtChange))}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(row.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
