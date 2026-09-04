"use client";

import { DateInput } from "@/components/ui/date-input";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { Checkbox } from "@/components/ui/checkbox";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Ban,
  CalendarDays,
  Download,
  ExternalLink,
  FileDown,
  FileInput,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { Pagination } from "@/components/pagination";
import { DataTableShell, RowPreviewModal, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { FilterTriggerButton, ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { CustomerCreateDialog } from "@/components/partners/customer-create-dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { Routes } from "@/lib/routes";
import { OrderDetailLink } from "@/components/order-detail-link";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { setCustomerActive } from "@/lib/actions/partners";
import type { CustomerFilters, CustomerListResult } from "@/lib/data/partners";
import { CustomerEdit } from "../../customers/[id]/customer-edit";
import { OrderStatusBadge } from "../../orders/status-badges";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import { CustomerReceivableActions } from "@/components/partners/customer-receivable-actions";
import { useAppDataQuery } from "@/components/use-app-data-query";
import {
  DEFAULT_PARTNER_DEBT_FILTER,
  PartnerDebtFilterControl,
  matchesPartnerDebtFilter,
} from "@/components/partners/partner-debt-filter";

type CustomerRow = CustomerListResult["rows"][number];
type CustomerExpandTab = "info" | "sales" | "debt";
type OrderPreview = {
  id: string;
  code: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  createdAt: string;
  total: string | number;
  amountPaid: string | number;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  shippingFee: string | number;
  items: Array<{
    id: string; productName: string; unitName: string; quantity: string | number;
    unitPrice: string | number; discount: string | number; total: string | number;
    preDiscountUnitPrice?: string | number | null;
    lineDiscountMode?: "pct" | "vnd" | null;
    lineDiscountValue?: string | number | null;
    priceBookName?: string | null;
  }>;
  payments: Array<{ id: string; createdAt: string; method: string; amount: string | number; note: string | null }>;
};

async function loadOrderPreview(orderId: string, signal: AbortSignal): Promise<OrderPreview> {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/preview`, { cache: "no-store", signal });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error("errors.serverError");
  const order = payload.data.order as OrderPreview;
  return { ...order, items: order.items.map((item) => ({ ...item, ...readOrderLinePricing(item) })) };
}

function useOrderPreview() {
  const t = useTranslations();
  const [orderId, setOrderId] = useState<string | null>(null);
  const { state } = useAppDataQuery(orderId, loadOrderPreview);
  return {
    openOrderPreview: setOrderId,
    closeOrderPreview: () => setOrderId(null),
    preview: state && { loading: state.loading, order: state.data, error: state.error ? t(state.error as never) : undefined },
  };
}

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
  returnPrintTemplates,
  aiPreview = false,
  initialDetailId = null,
  initialDetailCustomer = null,
}: {
  data: CustomerListResult;
  filters: CustomerFilters;
  returnPrintTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  aiPreview?: boolean;
  initialDetailId?: string | null;
  initialDetailCustomer?: CustomerRow | null;
}) {
  const t = useTranslations();
  const [filterOpen, setFilterOpen] = useState(false);
  return (
    <div className="min-w-0">
      <section className="min-w-0">
        <CustomerRows data={data} filters={filters} returnPrintTemplates={returnPrintTemplates} aiPreview={aiPreview} initialDetailId={initialDetailId} initialDetailCustomer={initialDetailCustomer} onOpenFilters={() => setFilterOpen(true)} />

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
              <button type="button" onClick={() => setFilterOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-surface-2 hover:text-slate-700 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
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
}: {
  filters: CustomerFilters;
  pageSize: number;
  onOpenFilters: () => void;
}) {
  const t = useTranslations();

  return (
    <ListSearchFilterBar
      search={(
        <InstantFilterForm action={Routes.Partners}>
          <input type="hidden" name="tab" value="customers" />
          <input type="hidden" name="size" value={pageSize} />
          <HiddenFilterInputs filters={filters} includeQ={false} />
          <ListSearchInput
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("customers.searchPlaceholder")}
          />
        </InstantFilterForm>
      )}
      filter={(
        <FilterTriggerButton
          onClick={onOpenFilters}
          label={t("suppliers.filter.button")}
          active={FILTER_KEYS.some((key) => Boolean(filters[key]))}
          hideLabelOnSmallScreens
        />
      )}
    />
  );
}

function CustomerRows({
  data,
  filters,
  returnPrintTemplates,
  aiPreview,
  onOpenFilters,
  initialDetailId,
  initialDetailCustomer,
}: {
  data: CustomerListResult;
  filters: CustomerFilters;
  returnPrintTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  aiPreview: boolean;
  onOpenFilters: () => void;
  initialDetailId: string | null;
  initialDetailCustomer: CustomerRow | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(aiPreview);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialDetailId);
  const [detailTab, setDetailTab] = useState<CustomerExpandTab>("info");
  const selectedCustomer = data.rows.find((customer) => customer.id === selectedCustomerId)
    ?? (initialDetailCustomer?.id === selectedCustomerId ? initialDetailCustomer : null);
  function closeCustomer() {
    setSelectedCustomerId(null);
    if (searchParams.has("detailCustomerId")) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("detailCustomerId");
      router.replace(`${Routes.Partners}?${next.toString()}`, { scroll: false });
    }
  }
  const columns: DataTableColumn<CustomerRow>[] = [
    {
      key: "select",
      label: <Checkbox className="h-4 w-4" aria-label={t("customers.selectAll")} />,
      required: true,
      width: "44px",
      align: "center",
      render: (customer) => <Checkbox className="h-4 w-4" aria-label={customer.name} onClick={stopRowToggle} />,
    },
    { key: "code", label: t("customers.cols.code"), defaultVisible: true, width: "130px", render: (customer) => <span className="font-medium">{customer.code ?? "—"}</span> },
    { key: "name", label: t("customers.cols.name"), required: true, render: (customer) => <PartnerDetailLink kind="customer" partnerId={customer.id} name={customer.name} className="font-semibold" /> },
    { key: "phone", label: t("customers.cols.phone"), defaultVisible: true, width: "130px", render: (customer) => <span className="text-slate-600 dark:text-slate-300">{customer.phone ?? "—"}</span> },
    { key: "debt", label: t("customers.cols.debtCurrent"), defaultVisible: true, align: "right", width: "150px", cellClassName: (customer) => Number(customer.currentDebt) > 0 ? "font-semibold text-er" : "font-semibold text-slate-400", render: (customer) => formatCurrency(Number(customer.currentDebt)) },
    { key: "grossSales", label: t("customers.cols.totalGrossSales"), defaultVisible: true, align: "right", width: "170px", render: (customer) => formatCurrency(Number(customer.grossSales)) },
    { key: "netSales", label: t("customers.cols.totalSalesNet"), defaultVisible: true, align: "right", width: "190px", render: (customer) => formatCurrency(Number(customer.totalSpent)) },
  ];

  return (
    <>
      <DataTableShell
        tableId="partners.customers"
        rows={data.rows}
        columns={columns}
        getRowId={(customer) => customer.id}
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
            <CustomerSearch filters={filters} pageSize={data.pageSize} onOpenFilters={onOpenFilters} />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => setCreateOpen(true)} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 shrink-0 rounded-lg min-h-11 min-w-11 lg:min-h-0 lg:min-w-0")}>
                <Plus className="h-4 w-4" />
                {t("customers.createNew")}
              </button>
              <Link href="/settings/import" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 shrink-0 rounded-lg min-h-11 min-w-11 lg:min-h-0 lg:min-w-0")}>
                <FileInput className="h-4 w-4" />
                {t("customers.actions.importFile")}
              </Link>
            </div>
          </div>
        )}
        onRowClick={(customer) => {
          setSelectedCustomerId(customer.id);
          setDetailTab("info");
        }}
        renderMobileRow={({ row: customer }) => (
          <article className="w-full p-3 text-left min-h-11">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold"><PartnerDetailLink kind="customer" partnerId={customer.id} name={customer.name} /></div>
                <button type="button" onClick={() => {
                  setSelectedCustomerId(customer.id);
                  setDetailTab("info");
                }} className="inline-flex min-h-11 min-w-11 items-center text-xs text-slate-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{customer.code ?? t("customers.expand.profile")} · {customer.phone ?? "—"}</button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Metric label={t("customers.cols.debt")} value={formatCurrency(Number(customer.currentDebt))} tone={Number(customer.currentDebt) > 0 ? "danger" : "muted"} />
              <Metric label={t("customers.cols.totalGrossSales")} value={formatCurrency(Number(customer.grossSales))} />
              <Metric label={t("customers.cols.totalSalesNet")} value={formatCurrency(Number(customer.totalSpent))} />
            </div>
          </article>
        )}
      />
      <CustomerCreateDialog
        open={createOpen}
        aiPreview={aiPreview}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
      <RowPreviewModal
        open={Boolean(selectedCustomerId)}
        onClose={closeCustomer}
        title={selectedCustomer?.name ?? t("customers.expand.profile")}
        subtitle={selectedCustomer ? [selectedCustomer.code, selectedCustomer.phone].filter(Boolean).join(" · ") : undefined}
        closeLabel={t("common.close")}
        bodyClassName="flex flex-col !overflow-hidden"
        footer={selectedCustomer && <CustomerDetailFooter customer={selectedCustomer} tab={detailTab} />}
      >
        {selectedCustomer ? <CustomerDetail customer={selectedCustomer} tab={detailTab} returnPrintTemplates={returnPrintTemplates} onTabChange={setDetailTab} /> : <div className="p-8 text-center text-sm text-slate-500">{t("errors.notFound")}</div>}
      </RowPreviewModal>
    </>
  );
}

function CustomerDetail({
  customer,
  tab,
  returnPrintTemplates,
  onTabChange,
}: {
  customer: CustomerRow;
  tab: CustomerExpandTab;
  returnPrintTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  onTabChange: (tab: CustomerExpandTab) => void;
}) {
  const t = useTranslations();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-6 overflow-x-auto overscroll-x-contain border-b border-border-soft text-sm font-semibold text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CUSTOMER_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={cn(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 px-2 transition-colors lg:min-h-0 lg:min-w-0 lg:pb-2",
              tab === key ? "border-primary-600 text-primary-600" : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`customers.expand.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden pt-4">
        {tab === "info" && <CustomerInfoPanel customer={customer} />}
        {tab === "sales" && <CustomerSalesPanel customer={customer} returnPrintTemplates={returnPrintTemplates} />}
        {tab === "debt" && <CustomerDebtPanel customer={customer} />}
      </div>
    </div>
  );
}

function CustomerInfoPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto pr-1">
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
      </div>

    </div>
  );
}

function CustomerSalesPanel({ customer, returnPrintTemplates }: { customer: CustomerRow; returnPrintTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[] }) {
  const t = useTranslations();
  const { preview, openOrderPreview, closeOrderPreview } = useOrderPreview();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {customer.salesHistory.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto"><EmptyPanel message={t("customers.expand.emptySales")} /></div>
      ) : (
        <>
        <div className="min-h-0 flex-1 divide-y divide-border-soft overflow-auto lg:hidden" data-mobile-audit="customer-sales">
          {customer.salesHistory.map((row) => (
            <article key={`${row.kind}-${row.id}`} className="space-y-2 border border-border-soft p-3 first:rounded-t-card last:rounded-b-card">
              <div className="flex items-start justify-between gap-3">
                {row.kind === "order" && row.orderId ? (
                  <button type="button" onClick={() => openOrderPreview(row.orderId!)} className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{row.code}</button>
                ) : (
                  <PrintTemplateMenu baseHref={`/returns/${row.id}/print`} templates={returnPrintTemplates} label={row.code} className="min-h-11 min-w-11 font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" />
                )}
                <OrderStatusBadge status={row.status} />
              </div>
              <div className="text-xs text-slate-500">{formatDate(row.createdAt)} · {row.sellerName ?? t("customers.emptyValue")}</div>
              <div className="text-right text-sm font-semibold tabular-nums">{formatCurrency(Number(row.total))}</div>
            </article>
          ))}
        </div>
        <div className="hidden min-h-0 flex-1 overscroll-contain overflow-auto lg:block">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10">
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
                      <PrintTemplateMenu baseHref={`/returns/${row.id}/print`} templates={returnPrintTemplates} label={row.code} className="text-primary-600 hover:underline" />
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
        </>
      )}

      <OrderPreviewDialog preview={preview} onClose={closeOrderPreview} />
    </div>
  );
}

function CustomerDebtPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const [filter, setFilter] = useState(DEFAULT_PARTNER_DEBT_FILTER);
  const { preview, openOrderPreview, closeOrderPreview } = useOrderPreview();
  const rows = useMemo(
    () => customer.debtLedger.filter((row) => matchesPartnerDebtFilter(row, filter)),
    [customer.debtLedger, filter],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PartnerDebtFilterControl value={filter} onChange={setFilter} />

      {rows.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto"><EmptyPanel message={t("customers.expand.emptyDebt")} /></div>
      ) : (
        <>
        <div className="min-h-0 flex-1 divide-y divide-border-soft overflow-auto lg:hidden" data-mobile-audit="customer-debt">
          {rows.map((row) => (
            <article key={`${row.kind}-${row.id}`} className="space-y-2 border border-border-soft p-3 first:rounded-t-card last:rounded-b-card">
              <div className="flex items-start justify-between gap-3">
                {row.orderId ? (
                  <button type="button" onClick={() => openOrderPreview(row.orderId!)} className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{row.code}</button>
                ) : (
                  <span className="font-semibold text-primary-600">{row.code}</span>
                )}
                <span className={cn("shrink-0 font-semibold tabular-nums", row.value < 0 ? "text-ok" : "text-slate-900 dark:text-slate-100")}>{formatCurrency(row.value)}</span>
              </div>
              <div className="text-xs text-slate-500">{formatDate(row.createdAt)} · {row.typeLabel}</div>
              <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-2 text-xs">
                <span className="text-slate-500">{t("customers.expand.debtCols.balance")}</span>
                <span className={cn("font-semibold tabular-nums", row.balance > 0 ? "text-er" : "text-slate-500")}>{formatCurrency(row.balance)}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden min-h-0 flex-1 overscroll-contain overflow-auto lg:block">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 z-10">
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
        </>
      )}

      <OrderPreviewDialog preview={preview} onClose={closeOrderPreview} />
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
  const total = order ? Number(order.total) : 0;
  const paid = order ? Number(order.amountPaid) : 0;

  return (
    <RowPreviewModal
      open={Boolean(preview)}
      onClose={onClose}
      title={order ? order.code : t("orders.title")}
      subtitle={order ? <><PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} /> · {formatDate(order.createdAt)}</> : undefined}
      footer={order && (
        <div className="flex justify-end">
          <OrderDetailLink orderId={order.id} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110 lg:min-h-10 min-w-11 lg:min-w-0">
            <ExternalLink className="h-4 w-4" />
            Mở phiếu
          </OrderDetailLink>
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
            <InfoField label={t("orders.cols.customer")} value={<PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} />} />
            <InfoField label={t("orders.cols.date")} value={formatDate(order.createdAt)} />
            <InfoField label={t("orders.cols.status")} value={order.status} />
          </div>
          <div className="divide-y divide-border-soft overflow-hidden rounded-lg border border-border lg:hidden" data-mobile-audit="customer-order-preview">
            {order.items.map((item) => (
              <article key={item.id} className="space-y-2 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 break-words font-medium">{item.productName}<div className="mt-0.5 text-xs text-slate-400">{item.unitName}{item.priceBookName && ` · ${item.priceBookName}`}</div></div>
                  <div className="shrink-0 font-semibold tabular-nums">{formatCurrency(Number(item.total))}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>{Number(item.quantity).toLocaleString("vi-VN")} × {formatCurrency(Number(item.unitPrice))}</span>
                  <span className="text-right">{t("orders.cols.discount")}: {Number(item.discount) > 0 ? <>{item.lineDiscountMode === "pct" && `${Number(item.lineDiscountValue).toLocaleString("vi-VN")}% · `}{formatCurrency(Number(item.discount))}</> : "—"}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
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
                    <td className="px-3 py-3 font-medium">{item.productName}<div className="text-xs text-slate-400">{item.unitName}{item.priceBookName && ` · ${item.priceBookName}`}</div></td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(item.quantity).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitPrice))}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{Number(item.discount) > 0 ? <>{item.lineDiscountMode === "pct" && <div>{Number(item.lineDiscountValue).toLocaleString("vi-VN")}%</div>}{formatCurrency(Number(item.discount))}</> : "—"}</td>
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

function CustomerDetailFooter({ customer, tab }: { customer: CustomerRow; tab: CustomerExpandTab }) {
  const t = useTranslations();

  if (tab === "info") return <CustomerActionBar customer={customer} />;
  if (tab === "sales") {
    return (
      <div className="flex justify-start">
        <ActionButton icon={Download} label={t("customers.actions.exportFile")} disabled />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap gap-2">
        <ActionButton icon={FileDown} label={t("customers.actions.exportDebtFile")} onClick={() => exportCustomerDebtCsv(customer)} />
        <ActionButton icon={Download} label={t("customers.actions.exportFile")} onClick={() => exportCustomerDebtCsv(customer)} />
      </div>
      <div className="flex flex-wrap gap-2 xl:justify-end">
        <CustomerReceivableActions customerId={customer.id} currentDebt={Number(customer.currentDebt)} />
      </div>
    </div>
  );
}

function exportCustomerDebtCsv(customer: CustomerRow) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["Mã phiếu", "Thời gian", "Loại", "Giá trị", "Dư nợ khách hàng"],
    ...customer.debtLedger.map((row) => [
      row.code,
      formatDate(row.createdAt),
      row.typeLabel,
      row.value,
      row.balance,
    ]),
  ];
  const blob = new Blob([`\ufeff${rows.map((row) => row.map(quote).join(",")).join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cong-no-${customer.code || customer.id}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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
    <div>
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
            zaloUserId: customer.zaloUserId,
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
    <InstantFilterForm action={Routes.Partners} className="space-y-5">
      <input type="hidden" name="tab" value="customers" />
      <input type="hidden" name="size" value={pageSize} />
      {filters.q && <input type="hidden" name="q" value={filters.q} />}

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

      <DateRangeFilter title={t("customers.filters.lastTransaction")} fromName="lastTxFrom" toName="lastTxTo" fromValue={filters.lastTxFrom} toValue={filters.lastTxTo} />
      <MoneyRangeFilter title={t("customers.filters.totalSales")} fromName="totalFrom" toName="totalTo" fromValue={filters.totalFrom} toValue={filters.totalTo} />
      <MoneyRangeFilter title={t("customers.filters.currentDebt")} fromName="debtFrom" toName="debtTo" fromValue={filters.debtFrom} toValue={filters.debtTo} />

      <div className="flex gap-2 border-t border-border-soft pt-4">
        <Link href={clearHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 rounded-lg min-h-11 min-w-11 lg:min-h-0 lg:min-w-0")}>{t("customers.filters.clear")}</Link>
      </div>
    </InstantFilterForm>
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
          <DateInput type="date" name={fromName} defaultValue={fromValue ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" aria-label={t("customers.filters.from")} />
          <DateInput type="date" name={toName} defaultValue={toValue ?? ""} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" aria-label={t("customers.filters.to")} />
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
        <input name={fromName} inputMode="numeric" defaultValue={fromValue ?? ""} placeholder={t("customers.filters.fromValue")} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" />
        <input name={toName} inputMode="numeric" defaultValue={toValue ?? ""} placeholder={t("customers.filters.toValue")} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" />
      </div>
    </div>
  );
}

function RadioPill({ name, value, checked, label }: { name: string; value: string; checked: boolean; label: string }) {
  return (
    <label className={cn("inline-flex h-9 min-h-11 min-w-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold lg:min-h-0 lg:min-w-0", checked ? "border-primary-600 bg-primary-600 text-white" : "border-border bg-surface text-slate-600 hover:bg-surface-2")}>
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

function InfoField({ label, value, icon: Icon }: { label: string; value?: React.ReactNode; icon?: LucideIcon }) {
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
  "inline-flex h-10 min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 lg:min-h-0 lg:min-w-0";
