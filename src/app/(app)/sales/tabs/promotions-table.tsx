"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { isPromoActive } from "@/lib/promo";
import { PromoToggle } from "../../promotions/promo-widgets";

type PromotionRow = {
  id: string;
  name: string;
  tiers: { minQty: number; discountPct: number }[] | null;
  isActive: boolean;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  productName: string;
  baseUnit: string;
};

export function PromotionsTable({ rows }: { rows: PromotionRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<PromotionRow>[] = [
    { key: "name", label: t("promos.cols.name"), required: true, render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "product", label: t("orders.cols.product"), defaultVisible: true, render: (row) => row.productName },
    { key: "tiers", label: t("promos.cols.tiers"), defaultVisible: true, render: (row) => <TierList row={row} /> },
    {
      key: "period",
      label: t("promos.cols.period"),
      defaultVisible: true,
      width: "220px",
      render: (row) => <span className="text-xs text-slate-500">{row.startsAt ? formatDate(row.startsAt) : "—"} → {row.endsAt ? formatDate(row.endsAt) : t("promos.noEnd")}</span>,
    },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, width: "130px", render: (row) => <Status row={row} /> },
    {
      key: "actions",
      label: "",
      required: true,
      width: "88px",
      align: "right",
      render: (row) => <span onClick={stopRowToggle}><PromoToggle id={row.id} isActive={row.isActive} /></span>,
    },
  ];

  return (
    <DataTableShell
      tableId="sales.promotions"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="980px"
      rowClassName={(row) => cn(!isPromoActive(row) && "opacity-60")}
      renderExpanded={(row) => (
        <div className="space-y-4 bg-surface px-4 py-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Info label={t("promos.cols.name")} value={row.name} />
            <Info label={t("orders.cols.product")} value={`${row.productName} · ${row.baseUnit}`} />
            <Info label={t("orders.cols.status")} value={isPromoActive(row) ? t("promos.active") : t("promos.inactive")} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">{t("promos.cols.tiers")}</div>
            <TierList row={row} />
          </div>
        </div>
      )}
    />
  );
}

function TierList({ row }: { row: PromotionRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(row.tiers ?? []).map((tier, index) => (
        <span key={index} className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-950/40 dark:text-primary-400">
          ≥{formatNumber(tier.minQty)} {row.baseUnit} → -{tier.discountPct}%
        </span>
      ))}
    </div>
  );
}

function Status({ row }: { row: PromotionRow }) {
  const t = useTranslations();
  const active = isPromoActive(row);
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", active ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{active ? t("promos.active") : t("promos.inactive")}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
