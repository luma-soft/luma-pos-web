"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Ban,
  CalendarDays,
  ChevronDown,
  Download,
  FileDown,
  FileInput,
  Filter,
  HelpCircle,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  QrCode,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  User,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { Pagination } from "@/components/pagination";
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
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden xl:block">
        <div className="sticky top-[112px] rounded-card border border-border bg-surface p-4">
          <CustomerFilterForm filters={filters} pageSize={data.pageSize} />
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CustomerSearch filters={filters} pageSize={data.pageSize} onOpenFilters={() => setFilterOpen(true)} activeFilterCount={activeFilterCount} />
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
            <ToolbarIcon icon={Filter} label={t("customers.filters.title")} onClick={() => setFilterOpen(true)} />
            <ToolbarIcon icon={Settings} label={t("customers.actions.settings")} />
            <ToolbarIcon icon={HelpCircle} label={t("customers.actions.help")} />
          </div>
        </div>

        {data.rows.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
            <User className="mx-auto mb-3 h-10 w-10 opacity-60" />
            <p className="font-medium">{t("customers.empty")}</p>
          </div>
        ) : (
          <CustomerRows data={data} />
        )}

        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          total={data.total}
          pageSize={data.pageSize}
          unitLabel={t("customers.unitLabel")}
        />
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-950/40 xl:hidden" onMouseDown={() => setFilterOpen(false)}>
          <div
            className="ml-auto flex h-full w-full max-w-sm flex-col overflow-auto bg-surface p-4 shadow-2xl"
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

function CustomerRows({ data }: { data: CustomerListResult }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const expandedId = params.get("expandedCustomer");

  function setExpanded(nextId: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (nextId) sp.set("expandedCustomer", nextId);
    else sp.delete("expandedCustomer");
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <>
      <div className="space-y-2 lg:hidden">
        {data.rows.map((customer) => {
          const expanded = expandedId === customer.id;
          return (
            <div key={customer.id} className={cn("overflow-hidden rounded-card border bg-surface", expanded ? "border-primary-300 shadow-e1" : "border-border")}>
              <button type="button" onClick={() => setExpanded(expanded ? null : customer.id)} className="w-full p-3 text-left">
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
              {expanded && <ExpandedCustomer customer={customer} />}
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface lg:block">
        <table className="w-full min-w-[1180px] text-sm">
          <thead>
            <tr className="bg-primary-50/70 text-left text-xs font-semibold text-slate-700 dark:bg-primary-950/20 dark:text-slate-300">
              <th className="w-11 px-4 py-3"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={t("customers.selectAll")} /></th>
              <th className="px-4 py-3">{t("customers.cols.code")}</th>
              <th className="px-4 py-3">{t("customers.cols.name")}</th>
              <th className="px-4 py-3">{t("customers.cols.phone")}</th>
              <th className="px-4 py-3 text-right">{t("customers.cols.debtCurrent")}</th>
              <th className="px-4 py-3 text-right">{t("customers.cols.totalGrossSales")}</th>
              <th className="px-4 py-3 text-right">{t("customers.cols.totalSalesNet")}</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border-soft bg-surface text-right font-bold tabular-nums">
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3" />
              <td className="px-4 py-3">{formatCurrency(data.totalDebt)}</td>
              <td className="px-4 py-3">{formatCurrency(data.totalGrossSales)}</td>
              <td className="px-4 py-3">{formatCurrency(data.totalNetSales)}</td>
              <td className="px-4 py-3" />
            </tr>
            {data.rows.map((customer) => {
              const expanded = expandedId === customer.id;
              return (
                <Fragment key={customer.id}>
                  <tr
                    className={cn(
                      "border-t border-border-soft cursor-pointer transition-colors",
                      expanded ? "bg-primary-50/45 dark:bg-primary-950/15" : "hover:bg-surface-2",
                    )}
                    onClick={() => setExpanded(expanded ? null : customer.id)}
                  >
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={customer.name} />
                    </td>
                    <td className="px-4 py-3 font-medium">{customer.code ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{customer.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{customer.phone ?? "—"}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", Number(customer.currentDebt) > 0 ? "text-er" : "text-slate-400")}>
                      {formatCurrency(Number(customer.currentDebt))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(customer.grossSales))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(customer.totalSpent))}</td>
                    <td className="px-4 py-3 text-right">
                      <ChevronDown className={cn("ml-auto h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-primary-100 dark:border-primary-900/50">
                      <td colSpan={8} className="p-0">
                        <ExpandedCustomer customer={customer} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
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
                      <Link href={Routes.order(row.orderId)} className="text-primary-600 hover:underline">{row.code}</Link>
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
    </div>
  );
}

function CustomerDebtPanel({ customer }: { customer: CustomerRow }) {
  const t = useTranslations();
  const [filter, setFilter] = useState<DebtFilter>("all");
  const rows = useMemo(
    () => customer.debtLedger.filter((row) => filter === "all" || row.kind === filter),
    [customer.debtLedger, filter],
  );

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
                      <Link href={Routes.order(row.orderId)} className="text-primary-600 hover:underline">{row.code}</Link>
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
