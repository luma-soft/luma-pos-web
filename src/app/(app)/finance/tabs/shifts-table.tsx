"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getShifts } from "@/lib/data/shifts";

type ShiftRow = Awaited<ReturnType<typeof getShifts>>[number];

export function ShiftsTable({ rows }: { rows: ShiftRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ShiftRow>[] = [
    { key: "code", label: t("shifts.cols.code"), required: true, render: (row) => <span className="font-mono font-semibold text-primary-600">{row.code}</span> },
    { key: "cashier", label: t("shifts.cols.cashier"), defaultVisible: true, render: (row) => row.userName ?? "—" },
    { key: "opened", label: t("shifts.cols.opened"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.openedAt)}</span> },
    { key: "closed", label: t("shifts.cols.closed"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.closedAt ? formatDate(row.closedAt) : "—"}</span> },
    { key: "openingFloat", label: t("shifts.openFloat"), defaultVisible: true, align: "right", render: (row) => formatCurrency(Number(row.openingFloat)) },
    { key: "expected", label: t("shifts.expected"), defaultVisible: true, align: "right", render: (row) => row.expectedCash != null ? formatCurrency(Number(row.expectedCash)) : "—" },
    { key: "counted", label: t("shifts.counted"), defaultVisible: false, align: "right", render: (row) => row.countedCash != null ? formatCurrency(Number(row.countedCash)) : "—" },
    { key: "variance", label: t("shifts.variance"), defaultVisible: true, align: "right", cellClassName: (row) => varianceClass(row), render: (row) => varianceText(row) },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <Status row={row} /> },
  ];
  return (
    <DataTableShell
      tableId="finance.shifts"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("shifts.cols.code")} value={row.code} />
          <Info label={t("shifts.cols.cashier")} value={row.userName ?? "—"} />
          <Info label={t("shifts.cols.opened")} value={formatDate(row.openedAt)} />
          <Info label={t("shifts.cols.closed")} value={row.closedAt ? formatDate(row.closedAt) : "—"} />
          <Info label={t("shifts.openFloat")} value={formatCurrency(Number(row.openingFloat))} />
          <Info label={t("shifts.expected")} value={row.expectedCash != null ? formatCurrency(Number(row.expectedCash)) : "—"} />
          <Info label={t("shifts.counted")} value={row.countedCash != null ? formatCurrency(Number(row.countedCash)) : "—"} />
          <Info label={t("shifts.variance")} value={varianceText(row)} tone={varianceTone(row)} />
        </div>
      )}
    />
  );
}

function varianceText(row: ShiftRow) {
  const value = row.variance != null ? Number(row.variance) : null;
  return value == null ? "—" : `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function varianceTone(row: ShiftRow): "ok" | "er" | undefined {
  const value = row.variance != null ? Number(row.variance) : null;
  if (value == null || value === 0) return undefined;
  return value > 0 ? "ok" : "er";
}

function varianceClass(row: ShiftRow) {
  const tone = varianceTone(row);
  return cn("font-bold", tone === "ok" && "text-ok", tone === "er" && "text-er", !tone && "text-slate-400");
}

function Status({ row }: { row: ShiftRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", row.status === "open" ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{row.status === "open" ? t("shifts.status.open") : t("shifts.status.closed")}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "ok" | "er" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "ok" && "text-ok", tone === "er" && "text-er")}>{value}</div>
    </div>
  );
}
