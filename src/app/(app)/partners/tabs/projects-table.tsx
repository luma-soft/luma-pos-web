"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { ProjectToggle } from "../../projects/project-widgets";

type ProjectRow = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  customerName: string | null;
  orderCount: number;
  totalValue: string | number;
  remaining: string | number;
};

export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ProjectRow>[] = [
    { key: "name", label: t("projects.cols.name"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.name}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => row.customerName ?? "—" },
    { key: "orders", label: t("projects.cols.orders"), defaultVisible: true, align: "right", width: "110px", render: (row) => row.orderCount },
    { key: "value", label: t("projects.cols.value"), defaultVisible: true, align: "right", render: (row) => formatCurrency(Number(row.totalValue)) },
    {
      key: "remaining",
      label: t("orders.cols.remaining"),
      defaultVisible: true,
      align: "right",
      cellClassName: (row) => Number(row.remaining) > 0 ? "font-semibold text-er" : "text-slate-400",
      render: (row) => Number(row.remaining) > 0 ? formatCurrency(Number(row.remaining)) : "—",
    },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, width: "120px", render: (row) => <Status row={row} /> },
    {
      key: "actions",
      label: "",
      required: true,
      width: "88px",
      align: "right",
      render: (row) => <span onClick={stopRowToggle}><ProjectToggle id={row.id} status={row.status} /></span>,
    },
  ];

  return (
    <DataTableShell
      tableId="partners.projects"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="980px"
      rowClassName={(row) => cn(row.status === "done" && "opacity-60")}
      renderExpanded={(row) => (
        <div className="space-y-4 bg-surface px-4 py-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Info label={t("projects.cols.name")} value={row.name} />
            <Info label={t("orders.cols.customer")} value={row.customerName ?? "—"} />
            <Info label={t("projects.cols.orders")} value={String(row.orderCount)} />
            <Info label={t("orders.cols.remaining")} value={formatCurrency(Number(row.remaining))} tone={Number(row.remaining) > 0 ? "danger" : undefined} />
          </div>
          {row.address && <Info label={t("customers.fields.address")} value={row.address} />}
          <div className="flex justify-end">
            <Link href={`${Routes.Sales}?tab=orders&q=${encodeURIComponent(row.name)}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2">
              Xem hóa đơn
            </Link>
          </div>
        </div>
      )}
    />
  );
}

function Status({ row }: { row: ProjectRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", row.status === "active" ? "bg-in-soft text-in" : "bg-surface-2 text-slate-500")}>{t(`projects.status.${row.status}` as never)}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "danger" && "text-er")}>{value}</div>
    </div>
  );
}
