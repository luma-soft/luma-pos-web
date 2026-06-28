"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import type { getSuppliers } from "@/lib/data/partners";

type SupplierRow = Awaited<ReturnType<typeof getSuppliers>>["rows"][number];

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  const t = useTranslations();
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

  return (
    <DataTableShell
      tableId="partners.suppliers"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="860px"
      renderExpanded={(row) => (
        <div className="space-y-4 bg-surface px-4 py-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Info label={t("suppliers.cols.name")} value={row.name} />
            <Info label={t("customers.cols.phone")} value={row.phone ?? "—"} />
            <Info label={t("customers.fields.taxCode")} value={row.taxCode ?? "—"} />
            <Info label={t("suppliers.cols.debt")} value={formatCurrency(Number(row.currentDebt))} tone={Number(row.currentDebt) > 0 ? "warn" : undefined} />
          </div>
          <div className="flex justify-end">
            <Link href={Routes.supplier(row.id)} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2">
              Mở chi tiết
            </Link>
          </div>
        </div>
      )}
      renderMobileRow={({ row, expanded, toggle }) => {
        const debt = Number(row.currentDebt);
        return (
          <button type="button" onClick={toggle} className={cn("w-full p-3 text-left", expanded && "bg-primary-50/45")}>
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
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
