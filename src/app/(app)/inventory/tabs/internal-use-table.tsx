"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getInternalUseIssues } from "@/lib/data/internal-use";

type InternalUseRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];

export function InternalUseTable({ rows }: { rows: InternalUseRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<InternalUseRow>[] = [
    { key: "code", label: t("internalUse.cols.code"), required: true, render: (row) => <span className="font-mono font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "department", label: t("internalUse.department"), defaultVisible: true, render: (row) => row.department ?? "—" },
    { key: "reason", label: t("internalUse.reason"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.reason ?? "—"}</span> },
    { key: "items", label: t("internalUse.cols.items"), defaultVisible: true, align: "right", render: (row) => row.itemCount },
    { key: "cost", label: t("internalUse.cols.cost"), defaultVisible: true, align: "right", cellClassName: "font-bold text-warn", render: (row) => formatCurrency(Number(row.totalCost)) },
    { key: "by", label: t("internalUse.cols.by"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.createdByName ?? "—"}</span> },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <Status row={row} /> },
  ];
  return (
    <DataTableShell
      tableId="inventory.internal-use"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("internalUse.cols.code")} value={row.code} />
          <Info label={t("internalUse.department")} value={row.department ?? "—"} />
          <Info label={t("internalUse.reason")} value={row.reason ?? "—"} />
          <Info label={t("internalUse.cols.cost")} value={formatCurrency(Number(row.totalCost))} tone="warn" />
          <Info label={t("internalUse.cols.items")} value={String(row.itemCount)} />
          <Info label={t("internalUse.cols.by")} value={row.createdByName ?? "—"} />
          <Info label={t("orders.cols.date")} value={formatDate(row.createdAt)} />
        </div>
      )}
    />
  );
}

function Status({ row }: { row: InternalUseRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", row.status === "pending" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>{row.status === "pending" ? t("internalUse.status.pending") : t("internalUse.status.approved")}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
