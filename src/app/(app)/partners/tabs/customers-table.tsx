"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Ban,
  CalendarDays,
  ChevronDown,
  Download,
  ExternalLink,
  FileDown,
  FileInput,
  Filter,
  HelpCircle,
  Lock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  Search,
  SlidersHorizontal,
  Trash2,
  User,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { Pagination } from "@/components/pagination";
import { DataTableShell, RowPreviewModal, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { buttonVariants } from "@/components/ui/button-variants";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { setCustomerActive } from "@/lib/actions/partners";
import type { CustomerFilters, CustomerListResult } from "@/lib/data/partners";
import { CustomerEdit } from "../../customers/[id]/customer-edit";
import { OrderStatusBadge } from "../../orders/status-badges";

type CustomerRow = CustomerListResult["rows"][number];
type CustomerExpandTab = "info" | "sales" | "debt";
type DebtFilter = "all" | "sale" | "payment" | "return";
type OrderPreview = {
  id: string;
  code: string;
  status: string;
  customerName: string | null;
  createdAt: string;
  total: string | number;
  amountPaid: string | number;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  shippingFee: string | number;
  items: Array<{ id: string; productName: string; unitName: string; quantity: string | number; unitPrice: string | number; discount: string | number; total: string | number }>;
  payments: Array<{ id: string; createdAt: string; method: string; amount: string | number; note: string | null }>;
};

const CUSTOMER_EXPAND_TABS: CustomerExpandTab[] = ["info", "sales", "debt"];
const CUSTOMER_TYPES = ["retail", "wholesale", "contractor", "agent"] as const;
const FILTER_KEYS: Array<keyof CustomerFilters> = [
  "type",
  "createdFrom",
  "createdTo",
  "lastTxFrom",
  "lastTxTo",
  "totalFrom",
  "totalTo",
  "debtFrom",
  "debtTo",
];

export function CustomersTable({
  data,
  filters,
}: {
  data: CustomerListResult;
  filters: CustomerFilters;
}) {
  const t = useTranslations();
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = FILTER_KEYS.filter((key) => Boolean(filters[key])).length + (filters.owing ? 1 : 0);

  return (
    <div className="min-w-0">
      <section className="min-w-0">
        <CustomerRows data={data} filters={filters} onOpenFilters={() => setFilterOpen(true)} activeFilterCount={activeFilterCount} />

        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.pageSize}
          unitLabel={t("customers.unitLabel")}
        />
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-950/40" onMouseDown={() => setFilterOpen(false)}>
          <div
            className="ml-auto flex h-full w-full max-w-md flex-col overflow-auto bg-surface p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">{t("customers.filters.title")}</h2>
              <button type="button" onClick={() => setFilterOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-surface-2 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <CustomerFilterForm filters={filters} pageSize={data.pageSize} />
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerSearch({
  filters,
  pageSize,
  onOpenFilters,
  activeFilterCount,
}: {
  filters: CustomerFilters;
  pageSize: number;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  const t = useTranslations();

  return (
    <form action={Routes.Partners} className="flex min-w-0 flex-1 items-center gap-2">
      <input type="hidden" name="tab" value="customers" />
      <input type="hidden" name="size" value={pageSize} />
      <HiddenFilterInputs filters={filters} includeQ={false} />
      <div className="relative min-w-0 flex-1 lg:max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder={t("customers.searchPlaceholder")}
          className="h-10 w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-12 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        />
        <button
          type="button"
          onClick={onOpenFilters}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-surface-2 hover:text-slate-800"
          aria-label={t("customers.filters.title")}
          title={t("customers.filters.title")}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
      <button type="submit" className="hidden h-10 rounded-lg border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-2 sm:inline-flex sm:items-center">
        {t("common.search")}
      </button>
    </form>
  );
}

function CustomerRows({
  data,
  filters,
  onOpenFilters,
  activeFilterCount,
}: {
  data: CustomerListResult;
  filters: CustomerFilters;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  const t = useTranslations();
  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: "select",
      label: <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={t("customers.selectAll")} />,
      required: true,
      width: "44px",
      align: "center",
      render: (customer) => <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={customer.name} onClick={stopRowToggle} />,
    },
    { key: "code", label: t("customers.cols.code"), defaultVisible: true, width: "130px", render: (customer) => <span className="font-medium">{customer.code ?? "—"}</span> },
    { key: "name", label: t("customers.cols.name"), required: true, render: (customer) => <span className="font-semibold text-slate-900 dark:text-slate-100">{customer.name}</span> },
    { key: "phone", label: t("customers.cols.phone"), defaultVisible: true, width: "130px", render: (customer) => <span className="text-slate-600 dark:text-slate-300">{customer.phone ?? "—"}</span> },
    { key: "debt", label: t("customers.cols.debtCurrent"), defaultVisible: true, align: "right", width: "150px", cellClassName: (customer) => Number(customer.currentDebt) > 0 ? "font-semibold text-er" : "font-semibold text-slate-400", render: (customer) => formatCurrency(Number(customer.currentDebt)) },
    { key: "grossSales", label: t("customers.cols.totalGrossSales"), defaultVisible: true, align: "right", width: "170px", render: (customer) => formatCurrency(Number(customer.grossSales)) },
    { key: "netSales", label: t("customers.cols.totalSalesNet"), defaultVisible: true, align: "right", width: "190px", render: (customer) => formatCurrency(Number(customer.totalSpent)) },
  ];

  return (
    <DataTableShell
      tableId="partners.customers"
      rows={data.rows}
      columns={columns}
      getRowId={(customer) => customer.id}
      expandedParam="expandedCustomer"
      minWidth="980px"
      empty={(
        <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
          <User className="mx-auto mb-3 h-10 w-10 opacity-60" />
          <p className="font-medium">{t("customers.empty")}</p>
        </div>
      )}
      summaryCells={[
        { key: "debt", content: formatCurrency(data.totalDebt) },
        { key: "grossSales", content: formatCurrency(data.totalGrossSales) },
        { key: "netSales", content: formatCurrency(data.totalNetSales) },
      ]}
      toolbar={(
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CustomerSearch filters={filters} pageSize={data.pageSize} onOpenFilters={onOpenFilters} activeFilterCount={activeFilterCount} />
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            <Link href={Routes.CustomerNew} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 shrink-0 rounded-lg")}>
              <Plus className="h-4 w-4" />
              {t("customers.createNew")}
            </Link>
            <Link href="/settings/import" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 shrink-0 rounded-lg")}>
              <FileInput className="h-4 w-4" />
              {t("customers.actions.importFile")}
            </Link>
            <ToolbarIcon icon={MoreHorizontal} label={t("customers.actions.more")} />
            <ToolbarIcon icon={Filter} label={t("customers.filters.title")} onClick={onOpenFilters} />
            <ToolbarIcon icon={HelpCircle} label={t("customers.actions.help")} />
          </div>
        </div>
      )}
      renderExpanded={(customer) => <ExpandedCustomer customer={customer} />}
      renderMobileRow={({ row: customer, expanded, toggle }) => (
        <button type="button" onClick={toggle} className="w-full p-3 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{customer.name}</div>
              <div className="text-xs text-slate-400">{customer.code ?? "—"} · {customer.phone ?? "—"}</div>
            </div>
            <ChevronDown className={cn("mt-1 h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Metric label={t("customers.cols.debt")} value={formatCurrency(Number(customer.currentDebt))} tone={Number(customer.currentDebt) > 0 ? "danger" : "muted"} />
            <Metric label={t("customers.cols.totalGrossSales")} value={formatCurrency(Number(customer.grossSales))} />
            <Metric label={t("customers.cols.totalSalesNet")} value={formatCurrency(Number(customer.totalSpent))} />
          </div>
        </button>
      )}
    />
  );
}

function ExpandedCustomer({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const [tab, setTab] = useState<CustomerExpandTab>("info");

  return (
    <div className="border-t border-border-soft bg-surface px-4 py-4">
      <div className="flex items-center gap-6 overflow-x-auto border-b border-border-soft text-sm font-semibold text-slate-500">
        {CUSTOMER_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "shrink-0 border-b-2 pb-2 transition-colors",
              tab === key ? "border-primary-600 text-primary-600" : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`customers.expand.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "info" && <CustomerInfoPanel customer={customer} />}
        {tab === "sales" && <CustomerSalesPanel customer={customer} />}
        {tab === "debt" && <CustomerDebtPanel customer={customer} />}
      </div>
    </div>
  );
}

function CustomerInfoPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[150px_minmax(0,1fr)]">
        <div className="grid h-36 w-36 place-items-center rounded-full bg-primary-50 text-primary-300 dark:bg-primary-950/30">
          <User className="h-20 w-20" />
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
                {customer.name} <span className="text-sm font-medium text-slate-500">{customer.code}</span>
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span>{t("customers.expand.createdBy")}: <b>{customer.createdByName ?? t("customers.emptyValue")}</b></span>
                <span className="hidden h-4 w-px bg-border-soft sm:inline-block" />
                <span>{t("customers.expand.createdAt")}: <b>{formatDate(customer.createdAt)}</b></span>
                <span className="hidden h-4 w-px bg-border-soft sm:inline-block" />
                <span>{t("customers.expand.group")}: <b>{customer.customerGroupName ?? t(`customers.types.${customer.type}`)}</b></span>
              </div>
            </div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("customers.expand.profile")}</div>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-3">
            <InfoField label={t("customers.cols.phone")} value={customer.phone} />
            <InfoField label={t("customers.expand.birthday")} value={customer.birthday ? formatDate(customer.birthday) : null} />
            <InfoField label={t("customers.expand.gender")} value={customer.gender} />
            <InfoField label="Email" value={customer.email} />
            <InfoField label="Facebook" value={customer.facebook} />
            <InfoField label={t("customers.fields.address")} value={customer.address} />
          </div>
        </div>
      </div>

      <div className="border-t border-border-soft pt-4">
        <h4 className="mb-3 text-sm font-bold text-primary-600">{t("customers.expand.invoiceInfo")}</h4>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <InfoField label={t("customers.fields.taxCode")} value={customer.taxCode} />
          <InfoField label={t("customers.fields.note")} value={customer.note} icon={Pencil} />
        </div>
      </div>

      <CustomerActionBar customer={customer} />
    </div>
  );
}

function CustomerSalesPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const [preview, setPreview] = useState<{ loading: boolean; error?: string; order?: OrderPreview } | null>(null);

  async function openOrderPreview(orderId: string) {
    setPreview({ loading: true });
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/preview`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPreview({ loading: false, error: t("errors.serverError" as never) });
        return;
      }
      setPreview({ loading: false, order: json.data.order as OrderPreview });
    } catch {
      setPreview({ loading: false, error: t("errors.serverError" as never) });
    }
  }

  return (
    <div className="space-y-5">
      {customer.salesHistory.length === 0 ? (
        <EmptyPanel message={t("customers.expand.emptySales")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                <th className="px-3 py-3">{t("customers.expand.salesCols.code")}</th>
                <th className="px-3 py-3">{t("customers.expand.salesCols.time")}</th>
                <th className="px-3 py-3">{t("customers.expand.salesCols.seller")}</th>
                <th className="px-3 py-3 text-right">{t("customers.expand.salesCols.total")}</th>
                <th className="px-3 py-3">{t("customers.expand.salesCols.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {customer.salesHistory.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td className="px-3 py-3 font-semibold">
                    {row.kind === "order" && row.orderId ? (
                      <button type="button" onClick={() => openOrderPreview(row.orderId!)} className="text-primary-600 hover:underline">{row.code}</button>
                    ) : (
                      <Link href={`/returns/${row.id}/print`} className="text-primary-600 hover:underline">{row.code}</Link>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-700 dark:text-slate-200">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-3">{row.sellerName ?? t("customers.emptyValue")}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(row.total))}</td>
                  <td className="px-3 py-3"><OrderStatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-border-soft pt-4">
        <ActionButton icon={Download} label={t("customers.actions.exportFile")} disabled />
      </div>

      <OrderPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function CustomerDebtPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const [filter, setFilter] = useState<DebtFilter>("all");
  const [preview, setPreview] = useState<{ loading: boolean; error?: string; order?: OrderPreview } | null>(null);
  const rows = useMemo(
    () => customer.debtLedger.filter((row) => filter === "all" || row.kind === filter),
    [customer.debtLedger, filter],
  );

  async function openOrderPreview(orderId: string) {
    setPreview({ loading: true });
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/preview`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPreview({ loading: false, error: t("errors.serverError" as never) });
        return;
      }
      setPreview({ loading: false, order: json.data.order as OrderPreview });
    } catch {
      setPreview({ loading: false, error: t("errors.serverError" as never) });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as DebtFilter)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm font-medium"
        >
          <option value="all">{t("customers.debtFilter.all")}</option>
          <option value="sale">{t("customers.debtFilter.sale")}</option>
          <option value="payment">{t("customers.debtFilter.payment")}</option>
          <option value="return">{t("customers.debtFilter.return")}</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyPanel message={t("customers.expand.emptyDebt")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                <th className="px-3 py-3">{t("customers.expand.debtCols.code")}</th>
                <th className="px-3 py-3">{t("customers.expand.debtCols.time")}</th>
                <th className="px-3 py-3">{t("customers.expand.debtCols.type")}</th>
                <th className="px-3 py-3 text-right">{t("customers.expand.debtCols.value")}</th>
                <th className="px-3 py-3 text-right">{t("customers.expand.debtCols.balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <td className="px-3 py-3 font-semibold">
                    {row.orderId ? (
                      <button type="button" onClick={() => openOrderPreview(row.orderId!)} className="text-primary-600 hover:underline">{row.code}</button>
                    ) : (
                      <span className="text-primary-600">{row.code}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-3">{row.typeLabel}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", row.value < 0 ? "text-ok" : "text-slate-900 dark:text-slate-100")}>
                    {formatCurrency(row.value)}
                  </td>
                  <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", row.balance > 0 ? "text-er" : "text-slate-500")}>
                    {formatCurrency(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border-soft pt-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={FileDown} label={t("customers.actions.exportDebtFile")} disabled />
          <ActionButton icon={Download} label={t("customers.actions.exportFile")} disabled />
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <ActionButton icon={WalletCards} label={t("customers.actions.payment")} tone="primary" disabled />
          <ActionButton icon={Pencil} label={t("customers.actions.adjust")} disabled />
          <ActionButton icon={WalletCards} label={t("customers.actions.paymentDiscount")} disabled />
          <ActionButton icon={QrCode} label={t("customers.actions.createQr")} disabled />
        </div>
      </div>

      <OrderPreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function OrderPreviewDialog({
  preview,
  onClose,
}: {
  preview: { loading: boolean; error?: string; order?: OrderPreview } | null;
  onClose: () => void;
}) {
  const t = useTranslations();
  const order = preview?.order;
  const openHref = order ? `${Routes.Sales}?tab=orders&orderId=${encodeURIComponent(order.id)}&expandedOrder=${encodeURIComponent(order.id)}` : "#";
  const total = order ? Number(order.total) : 0;
  const paid = order ? Number(order.amountPaid) : 0;

  return (
    <RowPreviewModal
      open={Boolean(preview)}
      onClose={onClose}
      title={order ? order.code : t("orders.title")}
      subtitle={order ? `${order.customerName ?? t("orders.walkIn")} · ${formatDate(order.createdAt)}` : undefined}
      footer={order && (
        <div className="flex justify-end">
          <Link href={openHref} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110">
            <ExternalLink className="h-4 w-4" />
            Mở phiếu
          </Link>
        </div>
      )}
    >
      {preview?.loading ? (
        <div className="grid min-h-60 place-items-center text-sm font-semibold text-slate-500">
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải...</span>
        </div>
      ) : preview?.error ? (
        <div className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-er">{preview.error}</div>
      ) : order ? (
        <div className="space-y-5">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <InfoField label={t("orders.cols.customer")} value={order.customerName ?? t("orders.walkIn")} />
            <InfoField label={t("orders.cols.date")} value={formatDate(order.createdAt)} />
            <InfoField label={t("orders.cols.status")} value={order.status} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                  <th className="px-3 py-3">{t("orders.cols.product")}</th>
                  <th className="px-3 py-3 text-right">{t("orders.cols.qty")}</th>
                  <th className="px-3 py-3 text-right">{t("orders.cols.unitPrice")}</th>
                  <th className="px-3 py-3 text-right">{t("orders.cols.discount")}</th>
                  <th className="px-3 py-3 text-right">{t("orders.cols.lineTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-3 font-medium">{item.productName}<div className="text-xs text-slate-400">{item.unitName}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(item.quantity).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitPrice))}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{Number(item.discount) > 0 ? formatCurrency(Number(item.discount)) : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto max-w-sm space-y-2 text-sm">
            <PreviewLine label={t("pos.subtotal")} value={formatCurrency(Number(order.subtotal))} />
            <PreviewLine label={t("pos.discount")} value={formatCurrency(Number(order.discount))} />
            <PreviewLine label={t("pos.tax")} value={formatCurrency(Number(order.tax))} />
            <PreviewLine label={t("pos.shipping")} value={formatCurrency(Number(order.shippingFee))} />
            <PreviewLine label={t("pos.total")} value={formatCurrency(total)} strong />
            <PreviewLine label={t("orders.detail.remaining")} value={formatCurrency(Math.max(0, total - paid))} strong />
          </div>
        </div>
      ) : null}
    </RowPreviewModal>
  );
}

function PreviewLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("tabular-nums", strong && "font-bold")}>{value}</span>
    </div>
  );
}

function CustomerActionBar({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function stopCustomer() {
    if (pending) return;
    const ok = await dialog.confirm({
      description: t("customers.confirm.stop"),
      confirmLabel: t("customers.actions.stop"),
      variant: "warning",
    });
    if (!ok) return;
    setError("");
    startTransition(async () => {
      const res = await setCustomerActive({ id: customer.id, isActive: false });
      if (res.ok) router.refresh();
      else setError(t(res.error as never));
    });
  }

  return (
    <div className="border-t border-border-soft pt-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={Trash2} label={t("common.delete")} tone="danger" disabled title={t("customers.actions.deleteDisabled")} />
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <CustomerEdit customer={{
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            type: customer.type,
            taxCode: customer.taxCode,
            debtLimit: customer.debtLimit,
            note: customer.note,
          }} />
          {customer.isActive && (
            <ActionButton icon={Ban} label={t("customers.actions.stop")} onClick={stopCustomer} disabled={pending} />
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-er">{error}</p>}
    </div>
  );
}

function CustomerFilterForm({ filters, pageSize }: { filters: CustomerFilters; pageSize: number }) {
  const t = useTranslations();
  const clearHref = `${Routes.Partners}?tab=customers${filters.q ? `&q=${encodeURIComponent(filters.q)}` : ""}&size=${pageSize}`;

  return (
    <form action={Routes.Partners} className="space-y-5">
      <input type="hidden" name="tab" value="customers" />
      <input type="hidden" name="size" value={pageSize} />
      {filters.q && <input type="hidden" name="q" value={filters.q} />}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{t("customers.filters.group")}</h3>
          <span className="text-xs font-semibold text-primary-600">{t("customers.filters.createNew")}</span>
        </div>
        <select disabled className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm text-slate-400">
          <option>{t("customers.filters.allGroups")}</option>
        </select>
      </div>

      <DateRangeFilter title={t("customers.filters.createdAt")} fromName="createdFrom" toName="createdTo" fromValue={filters.createdFrom} toValue={filters.createdTo} />

      <div>
        <h3 className="mb-3 text-sm font-bold">{t("customers.filters.customerType")}</h3>
        <div className="flex flex-wrap gap-2">
          <RadioPill name="type" value="" checked={!filters.type} label={t("customers.tabs.all")} />
          {CUSTOMER_TYPES.map((type) => (
            <RadioPill key={type} name="type" value={type} checked={filters.type === type} label={t(`customers.types.${type}`)} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold">{t("customers.filters.debtStatus")}</h3>
        <div className="flex flex-wrap gap-2">
          <RadioPill name="owing" value="" checked={!filters.owing} label={t("customers.tabs.all")} />
          <RadioPill name="owing" value="1" checked={Boolean(filters.owing)} label={t("customers.tabs.owing")} />
        </div>
      </div>

      <DisabledFilter title={t("customers.filters.gender")} />
      <DisabledFilter title={t("customers.filters.birthday")} />
      <DateRangeFilter title={t("customers.filters.lastTransaction")} fromName="lastTxFrom" toName="lastTxTo" fromValue={filters.lastTxFrom} toValue={filters.lastTxTo} />
      <MoneyRangeFilter title={t("customers.filters.totalSales")} fromName="totalFrom" toName="totalTo" fromValue={filters.totalFrom} toValue={filters.totalTo} />
      <MoneyRangeFilter title={t("customers.filters.currentDebt")} fromName="debtFrom" toName="debtTo" fromValue={filters.debtFrom} toValue={filters.debtTo} />

      <div className="flex gap-2 border-t border-border-soft pt-4">
        <button type="submit" className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 flex-1 rounded-lg")}>{t("customers.filters.apply")}</button>
        <Link href={clearHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 rounded-lg")}>{t("customers.filters.clear")}</Link>
      </div>
    </form>
  );
}

function DateRangeFilter({
  title,
  fromName,
  toName,
  fromValue,
  toValue,
}: {
  title: string;
  fromName: string;
  toName: string;
  fromValue?: string;
  toValue?: string;
}) {
  const t = useTranslations();

  return (
    <div>
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <CalendarDays className="mt-2.5 h-4 w-4 text-primary-600" />
        <div className="grid gap-2">
          <input type="date" name={fromName} defaultValue={fromValue ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" aria-label={t("customers.filters.from")} />
          <input type="date" name={toName} defaultValue={toValue ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" aria-label={t("customers.filters.to")} />
        </div>
      </div>
    </div>
  );
}

function MoneyRangeFilter({
  title,
  fromName,
  toName,
  fromValue,
  toValue,
}: {
  title: string;
  fromName: string;
  toName: string;
  fromValue?: string;
  toValue?: string;
}) {
  const t = useTranslations();
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <div className="grid grid-cols-2 gap-2">
        <input name={fromName} inputMode="numeric" defaultValue={fromValue ?? ""} placeholder={t("customers.filters.fromValue")} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" />
        <input name={toName} inputMode="numeric" defaultValue={toValue ?? ""} placeholder={t("customers.filters.toValue")} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm" />
      </div>
    </div>
  );
}

function DisabledFilter({ title }: { title: string }) {
  const t = useTranslations();
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-slate-500">{title}</h3>
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-2 text-sm text-slate-400">
        <Lock className="h-4 w-4" />
        {t("customers.filters.noData")}
      </div>
    </div>
  );
}

function RadioPill({ name, value, checked, label }: { name: string; value: string; checked: boolean; label: string }) {
  return (
    <label className={cn("inline-flex h-9 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold", checked ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface text-slate-600 hover:bg-surface-2")}>
      <input type="radio" name={name} value={value} defaultChecked={checked} className="sr-only" />
      {label}
    </label>
  );
}

function HiddenFilterInputs({ filters, includeQ = true }: { filters: CustomerFilters; includeQ?: boolean }) {
  return (
    <>
      {includeQ && filters.q && <input type="hidden" name="q" value={filters.q} />}
      {filters.type && <input type="hidden" name="type" value={filters.type} />}
      {filters.owing && <input type="hidden" name="owing" value="1" />}
      {FILTER_KEYS.map((key) => {
        const value = filters[key];
        return typeof value === "string" && value ? <input key={key} type="hidden" name={key} value={value} /> : null;
      })}
    </>
  );
}

function InfoField({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: LucideIcon }) {
  const t = useTranslations();
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("mt-1 flex min-h-6 items-center gap-2 text-sm font-medium", value ? "text-slate-900 dark:text-slate-100" : "text-slate-400")}>
        {Icon && <Icon className="h-4 w-4 text-slate-500" />}
        {value || t("customers.emptyValue")}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" | "muted" }) {
  return (
    <span>
      <span className="block text-slate-400">{label}</span>
      <span className={cn("mt-0.5 block truncate font-semibold tabular-nums", tone === "danger" ? "text-er" : tone === "muted" ? "text-slate-500" : "text-slate-900 dark:text-slate-100")}>
        {value}
      </span>
    </span>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-border-soft px-4 py-10 text-center text-sm font-medium text-slate-400">
      {message}
    </div>
  );
}

function ToolbarIcon({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-slate-600 hover:bg-surface-2"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "neutral",
  title,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        actionClassName,
        tone === "primary" && "border-primary-600 bg-primary-600 text-white hover:border-primary-700 hover:bg-primary-700",
        tone === "danger" && "border-transparent bg-transparent text-slate-600 hover:bg-red-50 hover:text-er dark:text-slate-300 dark:hover:bg-red-950/30",
        tone === "neutral" && "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

const actionClassName =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
