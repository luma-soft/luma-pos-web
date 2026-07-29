"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { OrderListRow } from "@/lib/data/orders";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";

export function OrderSelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="inline-grid size-11 cursor-pointer place-items-center lg:size-4">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        onClick={stopRowToggle}
        aria-label={label}
        className="h-4 w-4 rounded border-slate-300 accent-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

export function OrderBatchToolbar({
  selectedCount,
  allSelected,
  partiallySelected,
  onToggleAll,
  labels,
}: {
  selectedCount: number;
  allSelected: boolean;
  partiallySelected: boolean;
  onToggleAll: () => void;
  labels: {
    selectAll: string;
    hint: string;
    merge: string;
    print: string;
  };
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-sm">
      <OrderSelectionCheckbox
        checked={allSelected}
        indeterminate={partiallySelected}
        onChange={onToggleAll}
        label={labels.selectAll}
      />
      <span className="min-w-0 flex-1 text-xs text-slate-500">{labels.hint}</span>
      <span className="rounded-full bg-primary-100 px-2 py-1 text-xs font-bold text-primary-700" aria-live="polite">
        {selectedCount}
      </span>
      <button
        type="submit"
        formAction="/orders/merge"
        disabled={selectedCount < 2}
        className="min-h-11 min-w-11 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:min-w-0"
      >
        {labels.merge}
      </button>
      <button
        type="submit"
        formAction="/orders/print-batch"
        disabled={selectedCount === 0}
        className="min-h-11 min-w-11 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:min-w-0"
      >
        {labels.print}
      </button>
    </div>
  );
}

export function OrderMobileRow({
  order,
  selected,
  onToggle,
  onOpen,
  labels,
}: {
  order: OrderListRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  labels: {
    walkIn: string;
    remaining: string;
  };
}) {
  const remaining = Number(order.total) - Number(order.amountPaid);
  const selectable = order.status !== "cancelled";
  return (
    <div className={cn("flex min-w-0 items-stretch", selected && "bg-primary-50/50 dark:bg-primary-950/20")}>
      <div className="shrink-0 p-3 pr-0 pt-3">
        <OrderSelectionCheckbox
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          label={order.code}
        />
      </div>
      <button type="button" onClick={onOpen} className="min-h-11 min-w-11 flex-1 p-3 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-primary-600">{order.code}</div>
            <div className="break-words text-xs text-slate-400">
              {formatDate(order.createdAt)} · {order.customerName ?? labels.walkIn} · {channelLabel(order.sourceMode)}
            </div>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold tabular-nums">{formatCurrency(Number(order.total))}</span>
          {remaining > 0 && order.status !== "cancelled"
            ? <span className="text-right font-semibold tabular-nums text-er">{labels.remaining}: {formatCurrency(remaining)}</span>
            : <PaymentStatusBadge status={order.paymentStatus} />}
        </div>
      </button>
    </div>
  );
}

export function OrdersTable({
  rows,
}: {
  rows: OrderListRow[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectableIds = rows
    .filter((order) => order.status !== "cancelled")
    .map((order) => order.id);
  const selectedVisibleIds = selectableIds.filter((id) => selectedIds.has(id));
  const allSelected =
    selectableIds.length > 0 &&
    selectedVisibleIds.length === selectableIds.length;

  function toggle(orderId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  function openOrder(order: OrderListRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("detailOrderId", order.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const columns: DataTableColumn<OrderListRow>[] = [
    {
      key: "select",
      label: (
        <OrderSelectionCheckbox
          checked={allSelected}
          indeterminate={selectedVisibleIds.length > 0 && !allSelected}
          onChange={toggleAll}
          label={t("common.selectAll")}
        />
      ),
      required: true,
      width: "44px",
      align: "center",
      render: (order) => (
        <OrderSelectionCheckbox
          checked={selectedIds.has(order.id)}
          disabled={order.status === "cancelled"}
          onChange={() => toggle(order.id)}
          label={order.code}
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
      {selectedVisibleIds.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <DataTableShell
        tableId="sales.orders"
        rows={rows}
        columns={columns}
        getRowId={(order) => order.id}
        minWidth="1120px"
        onRowClick={openOrder}
        rowClassName={(order) => cn(
          order.status === "cancelled" && "opacity-60",
          selectedIds.has(order.id) && "bg-primary-50/50 dark:bg-primary-950/20",
        )}
        toolbar={(
          <OrderBatchToolbar
            selectedCount={selectedVisibleIds.length}
            allSelected={allSelected}
            partiallySelected={selectedVisibleIds.length > 0 && !allSelected}
            onToggleAll={toggleAll}
            labels={{
              selectAll: t("common.selectAll"),
              hint: t("orders.batchHint"),
              merge: t("merge.title"),
              print: t("orders.printSelected"),
            }}
          />
        )}
        renderMobileRow={({ row: order }) => (
          <OrderMobileRow
            order={order}
            selected={selectedIds.has(order.id)}
            onToggle={() => toggle(order.id)}
            onOpen={() => openOrder(order)}
            labels={{
              walkIn: t("orders.walkIn"),
              remaining: t("orders.cols.remaining"),
            }}
          />
        )}
      />
    </form>
  );
}

function ChannelBadge({ source }: { source?: string | null }) {
  const online = Boolean(source && source !== "pos");
  return (
    <span className={cn(
      "inline-flex rounded-md px-2 py-1 text-xs font-bold",
      online ? "bg-warn-soft text-warn" : "bg-surface-2 text-slate-600",
    )}>
      {channelLabel(source)}
    </span>
  );
}

function channelLabel(source?: string | null) {
  if (source === "shopee") return "Shopee";
  if (source === "tiktok_shop") return "TikTok Shop";
  if (source === "lazada") return "Lazada";
  if (source === "tiki") return "Tiki";
  return "POS";
}
