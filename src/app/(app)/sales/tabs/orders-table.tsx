"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { OrderListRow } from "@/lib/data/orders";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";

export function OrdersTable({
  rows,
  expandedId,
  expandedContent,
}: {
  rows: OrderListRow[];
  expandedId?: string | null;
  expandedContent?: ReactNode;
}) {
  const t = useTranslations();
  const columns: DataTableColumn<OrderListRow>[] = [
    {
      key: "select",
      label: <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={t("common.selectAll")} />,
      required: true,
      width: "44px",
      align: "center",
      render: (order) => (
        <input
          type="checkbox"
          name="ids"
          value={order.id}
          disabled={order.status === "cancelled"}
          onClick={stopRowToggle}
          className="h-4 w-4 rounded border-slate-300"
          aria-label={order.code}
        />
      ),
    },
    {
      key: "code",
      label: t("orders.cols.code"),
      required: true,
      width: "132px",
      render: (order) => <span className="font-semibold text-primary-600">{order.code}</span>,
    },
    {
      key: "date",
      label: t("orders.cols.date"),
      defaultVisible: true,
      width: "160px",
      render: (order) => <span className="text-slate-500">{formatDate(order.createdAt)}</span>,
    },
    {
      key: "customer",
      label: t("orders.cols.customer"),
      defaultVisible: true,
      render: (order) => order.customerName ?? t("orders.walkIn"),
    },
    {
      key: "channel",
      label: "Channel",
      defaultVisible: true,
      width: "110px",
      render: (order) => <ChannelBadge source={order.sourceMode} />,
    },
    {
      key: "project",
      label: t("orders.cols.project"),
      defaultVisible: false,
      render: (order) => <span className="text-slate-500">{order.projectName ?? "—"}</span>,
    },
    {
      key: "total",
      label: t("orders.cols.total"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: "font-semibold",
      render: (order) => formatCurrency(Number(order.total)),
    },
    {
      key: "remaining",
      label: t("orders.cols.remaining"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: (order) => {
        const remaining = Number(order.total) - Number(order.amountPaid);
        return remaining > 0 && order.status !== "cancelled" ? "font-semibold text-er" : "text-slate-400";
      },
      render: (order) => {
        const remaining = Number(order.total) - Number(order.amountPaid);
        return remaining > 0 && order.status !== "cancelled" ? formatCurrency(remaining) : "—";
      },
    },
    {
      key: "payment",
      label: t("orders.cols.payment"),
      defaultVisible: true,
      width: "130px",
      render: (order) => <PaymentStatusBadge status={order.paymentStatus} />,
    },
    {
      key: "status",
      label: t("orders.cols.status"),
      defaultVisible: true,
      width: "130px",
      render: (order) => <OrderStatusBadge status={order.status} />,
    },
  ];

  return (
    <form action="/orders/print-batch">
      <DataTableShell
        tableId="sales.orders"
        rows={rows}
        columns={columns}
        getRowId={(order) => order.id}
        expandedParam="expandedOrder"
        initialExpandedId={expandedId}
        minWidth="1120px"
        rowClassName={(order) => cn(order.status === "cancelled" && "opacity-60")}
        renderExpanded={(order) => (expandedId === order.id ? expandedContent : null)}
        toolbar={(
          <div className="flex flex-1 items-center gap-3 text-sm">
            <span className="hidden text-xs text-slate-500 sm:inline">{t("orders.batchHint")}</span>
            <div className="flex-1" />
            <button type="submit" formAction="/orders/merge" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
              {t("merge.title")}
            </button>
            <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
              {t("orders.printSelected")}
            </button>
          </div>
        )}
        renderMobileRow={({ row: order, expanded, toggle }) => {
          const remaining = Number(order.total) - Number(order.amountPaid);
          return (
            <>
              <button type="button" onClick={toggle} className="w-full p-3 text-left">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                  <div className="font-semibold text-primary-600">{order.code}</div>
                    <div className="text-xs text-slate-400">{formatDate(order.createdAt)} · {order.customerName ?? t("orders.walkIn")} · {order.sourceMode === "shopee" ? "Shopee" : "POS"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="font-semibold tabular-nums">{formatCurrency(Number(order.total))}</span>
                  {remaining > 0 && order.status !== "cancelled"
                    ? <span className="font-semibold tabular-nums text-er">{t("orders.cols.remaining")}: {formatCurrency(remaining)}</span>
                    : <PaymentStatusBadge status={order.paymentStatus} />}
                </div>
              </button>
            </>
          );
        }}
      />
    </form>
  );
}

function ChannelBadge({ source }: { source?: string | null }) {
  const shopee = source === "shopee";
  return (
    <span className={cn(
      "inline-flex rounded-md px-2 py-1 text-xs font-bold",
      shopee ? "bg-warn-soft text-warn" : "bg-surface-2 text-slate-600",
    )}>
      {shopee ? "Shopee" : "POS"}
    </span>
  );
}
