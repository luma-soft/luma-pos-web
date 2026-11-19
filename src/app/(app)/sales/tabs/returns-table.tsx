"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePhoneLayout } from "@/components/use-phone-layout";
import { FileX2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { OrderDetailLink } from "@/components/order-detail-link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import type { ReturnListRow } from "@/lib/data/returns";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { MobileDocumentRow } from "./mobile-document-row";
import { mobileDocumentDayGroups, mobileDocumentTimestamp } from "./mobile-document-day";

export function ReturnsTable({
  rows: serverRows,
  loadMore,
  expandedId,
  expandedContent,
  expandedFooter,
  mobileDetail,
}: {
  rows: ReturnListRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<ReturnListRow>;
  expandedId?: string | null;
  expandedContent?: ReactNode;
  expandedFooter?: ReactNode;
  /** Phones: the pushed NativeReturnDetailView for the open return. */
  mobileDetail?: ReactNode;
}) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const t = useTranslations();
  const locale = useLocale();
  const phone = usePhoneLayout();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Phones push NativeReturnDetailView instead of the table's detail modal.
  function openMobile(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("expandedReturn", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const dayGroups = mobileDocumentDayGroups(rows, (row) => row.createdAt, (row) => Number(row.totalRefund), {
    locale,
    today: (date) => t("mobile.invoices.groupToday", { date }),
    yesterday: (date) => t("mobile.invoices.groupYesterday", { date }),
    summary: (count, total) => t("mobile.invoices.groupSummary", { count, total }),
  });
  const columns: DataTableColumn<ReturnListRow>[] = [
    {
      key: "code",
      label: t("returns.cols.code"),
      required: true,
      width: "150px",
      render: (row) => <span className="font-semibold text-primary-600">{row.code}</span>,
    },
    {
      key: "date",
      label: t("orders.cols.date"),
      defaultVisible: true,
      width: "160px",
      render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "order",
      label: t("returns.sourceOrder"),
      defaultVisible: true,
      width: "160px",
      render: (row) => row.orderId && row.orderCode
        ? <OrderDetailLink orderId={row.orderId} onClick={stopRowToggle} className="text-primary-600 hover:underline">{row.orderCode}</OrderDetailLink>
        : <span className="text-slate-400">-</span>,
    },
    {
      key: "customer",
      label: t("orders.cols.customer"),
      defaultVisible: true,
      wrap: true,
      render: (row) => <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? t("orders.walkIn")} openInCurrentTab className="whitespace-normal break-words" />,
    },
    {
      key: "reason",
      label: t("returns.reason"),
      defaultVisible: true,
      render: (row) => row.reason ? t(`returns.reasons.${row.reason}` as never) : <span className="text-slate-400">-</span>,
    },
    {
      key: "refundMethod",
      label: t("returns.refundVia"),
      defaultVisible: true,
      render: (row) => t(`returns.refundMethods.${row.refundMethod}`),
    },
    {
      key: "createdBy",
      label: t("returns.cols.createdBy"),
      defaultVisible: false,
      render: (row) => row.createdByName ?? <span className="text-slate-400">-</span>,
    },
    {
      key: "status",
      label: t("orders.cols.status"),
      defaultVisible: true,
      render: (row) => (
        <span className={row.status === "cancelled" ? "font-semibold text-er" : "font-semibold text-ok"}>
          {t(`returns.status.${row.status}` as never)}
        </span>
      ),
    },
    {
      key: "totalRefund",
      label: t("returns.totalRefund"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: "font-semibold text-er",
      render: (row) => formatCurrency(Number(row.totalRefund)),
    },
  ];

  return (
    <>
    <DataTableShell
      tableId="sales.returns"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      mobileListClassName="-mx-4 space-y-0 border-t border-border bg-surface"
      mobileRowClassName="!rounded-none !border-0"
      expandedParam={phone ? "expandedReturnModal" : "expandedReturn"}
      initialExpandedId={phone ? null : expandedId}
      detailSize="full"
      detailFooter={(row) => expandedId === row.id ? expandedFooter : null}
      minWidth="1120px"
      empty={(
        <SalesTableEmptyState
          icon={FileX2}
          title={t("returns.empty")}
          description={t("returns.emptyHint")}
        />
      )}
      renderMobileRow={({ row, toggle }) => (
        <MobileDocumentRow
          code={row.code}
          dayGroup={dayGroups.get(row.id)}
          customerName={row.customerName ?? t("orders.walkIn")}
          customer={(
            <PartnerDetailLink
              kind="customer"
              partnerId={row.customerId}
              name={row.customerName ?? t("orders.walkIn")}
              openInCurrentTab
              className="pointer-events-auto relative z-10 -my-3 block truncate py-3 text-foreground"
            />
          )}
          amount={formatCurrency(Number(row.totalRefund))}
          amountTone="danger"
          createdAt={mobileDocumentTimestamp(row.createdAt, locale)}
          onOpen={phone ? () => openMobile(row.id) : toggle}
          details={(
            <>
              <span className="block text-xs">
                <span className={row.status === "cancelled" ? "font-semibold text-er" : "font-semibold text-ok"}>
                  {t(`returns.status.${row.status}` as never)}
                </span>
                {" · "}
                {row.reason ? t(`returns.reasons.${row.reason}` as never) : "—"}
                {" · "}
                {t(`returns.refundMethods.${row.refundMethod}`)}
              </span>
              {row.orderId && row.orderCode && (
                <OrderDetailLink
                  orderId={row.orderId}
                  className="pointer-events-auto relative z-10 inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-primary-600 hover:underline"
                >
                  {t("returns.sourceOrder")}: {row.orderCode}
                </OrderDetailLink>
              )}
            </>
          )}
        />
      )}
      renderDetail={(row) => (
        expandedId === row.id && expandedContent
          ? expandedContent
          : (
              <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
                <Info label={t("returns.sourceOrder")} value={row.orderCode ?? "-"} />
                <Info label={t("returns.refundVia")} value={t(`returns.refundMethods.${row.refundMethod}`)} />
                <Info label={t("returns.cols.createdBy")} value={row.createdByName ?? "-"} />
                {row.note && <div className="md:col-span-4"><Info label={t("orders.detail.notePlaceholder")} value={row.note} /></div>}
              </div>
            )
      )}
    />
    {loadMoreFooter}
    {phone && expandedId && mobileDetail}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
