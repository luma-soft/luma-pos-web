"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import type { ProjectRow } from "@/lib/data/projects";
import { ProjectEdit, ProjectToggle } from "../../projects/project-widgets";

export function ProjectMobileRow({
  row,
  renderActions,
}: {
  row: ProjectRow;
  renderActions: (row: ProjectRow) => ReactNode;
}) {
  const t = useTranslations();
  const remaining = Number(row.remaining);
  return (
    <article className={cn("min-w-0 p-4", row.status === "done" && "opacity-60")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-primary-600">{row.name}</h3>
          <p className="mt-1 break-words text-xs text-slate-500"><PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? "—"} /></p>
        </div>
        <Status row={row} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
        <Info label={t("projects.cols.orders")} value={String(row.orderCount)} />
        <Info label={t("projects.cols.value")} value={formatCurrency(Number(row.totalValue))} />
        <Info
          label={t("orders.cols.remaining")}
          value={remaining > 0 ? formatCurrency(remaining) : "—"}
          tone={remaining > 0 ? "danger" : undefined}
        />
        <Info label={t("orders.cols.status")} value={t(`projects.status.${row.status}` as never)} />
      </dl>
      <div className="mt-4 grid gap-3">
        <Info label={t("customers.fields.address")} value={row.address ?? "—"} />
        <Info label={t("customers.fields.note")} value={row.note ?? "—"} />
      </div>
      <div className="mt-4 flex min-h-11 flex-wrap items-center justify-end gap-2 border-t border-border-soft pt-3">
        <Link
          href={Routes.project(row.id)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2"
        >
          {t("projects.viewDetail")}
        </Link>
        {renderActions(row)}
      </div>
    </article>
  );
}

export function ProjectsTable({ rows, customers }: { rows: ProjectRow[]; customers: { id: string; name: string }[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ProjectRow>[] = [
    { key: "name", label: t("projects.cols.name"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.name}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? "—"} /> },
    { key: "address", label: t("customers.fields.address"), defaultVisible: false, render: (row) => <span className="text-slate-500">{row.address ?? "—"}</span> },
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
      width: "132px",
      align: "right",
      render: (row) => (
        <span onClick={stopRowToggle} className="inline-flex items-center gap-2">
          <ProjectEdit project={row} customers={customers} />
          <ProjectToggle id={row.id} status={row.status} />
        </span>
      ),
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
      renderMobileRow={({ row }) => (
        <ProjectMobileRow
          row={row}
          renderActions={(actionRow) => (
            <>
              <ProjectEdit project={actionRow} customers={customers} />
              <ProjectToggle id={actionRow.id} status={actionRow.status} />
            </>
          )}
        />
      )}
      renderDetail={(row) => (
        <div className="space-y-4 bg-surface px-4 py-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Info label={t("projects.cols.name")} value={row.name} />
            <Info label={t("orders.cols.customer")} value={<PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? "—"} />} />
            <Info label={t("projects.cols.orders")} value={String(row.orderCount)} />
            <Info label={t("orders.cols.remaining")} value={formatCurrency(Number(row.remaining))} tone={Number(row.remaining) > 0 ? "danger" : undefined} />
          </div>
          {row.address && <Info label={t("customers.fields.address")} value={row.address} />}
          {row.note && <Info label={t("customers.fields.note")} value={row.note} />}
          <div className="flex justify-end">
            <Link href={Routes.project(row.id)} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
              {t("projects.viewDetail")}
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

function Info({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "danger" && "text-er")}>{value}</div>
    </div>
  );
}
