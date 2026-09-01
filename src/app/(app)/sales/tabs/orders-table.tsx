"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DataTableShell,
  stopRowToggle,
  type DataTableColumn,
} from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { OrderListRow } from "@/lib/data/orders";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
} from "../../orders/status-badges";
import { FileX2, Loader2, XCircle } from "lucide-react";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { cancelOrders } from "@/lib/actions/orders";
import { SalesTableEmptyState } from "./sales-table-empty-state";

export function normalizeOrderBatchSelection(
  selectedIds: Set<string>,
  selectableIds: string[],
) {
  const selectable = new Set(selectableIds);
  return new Set([...selectedIds].filter((id) => selectable.has(id)));
}

export function toggleOrderBatchSelection(
  selectedIds: Set<string>,
  orderId: string,
  selectableIds: string[],
) {
  const next = normalizeOrderBatchSelection(selectedIds, selectableIds);
  if (next.has(orderId)) {
    next.delete(orderId);
    return next;
  }
  if (!selectableIds.includes(orderId)) {
    return next;
  }
  next.add(orderId);
  return next;
}

export function toggleAllOrderBatchSelection(
  selectedIds: Set<string>,
  selectableIds: string[],
) {
  const current = normalizeOrderBatchSelection(selectedIds, selectableIds);
  const target = selectableIds;
  const targetFullySelected =
    target.length > 0 && target.every((id) => current.has(id));
  return targetFullySelected ? new Set<string>() : new Set(target);
}

export function OrderSelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  disabledReason,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label
      className="inline-grid size-11 cursor-pointer place-items-center lg:size-4"
      title={disabled ? disabledReason : undefined}
    >
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
  selectedIds,
  templates,
  cancelling,
  onCancel,
  labels,
}: {
  selectedCount: number;
  selectedIds: string[];
  templates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  cancelling: boolean;
  onCancel: () => void;
  labels: {
    merge: string;
    print: string;
    cancel: string;
    selected?: string;
  };
}) {
  const batchHref = `/orders/print-batch?${selectedIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&")}`;
  return (
    <div className="flex w-full items-center justify-end gap-2 text-sm">
      <span
        className="px-2 py-1 text-xs font-semibold text-slate-600"
        aria-live="polite"
      >
        {labels.selected ?? selectedCount}
      </span>
      <div className="grid grid-cols-2 gap-2 lg:contents">
        <button
          type="submit"
          formAction="/orders/merge"
          disabled={selectedCount < 2}
          className="min-h-11 min-w-11 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:min-w-0"
        >
          {labels.merge}
        </button>
        {selectedCount > 0 ? (
          <PrintTemplateMenu
            baseHref={batchHref}
            templates={templates}
            label={labels.print}
            className="min-h-11 min-w-11 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 lg:min-h-0 lg:min-w-0"
          />
        ) : (
          <button
            type="button"
            disabled
            className="min-h-11 min-w-11 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold opacity-50 lg:min-h-0 lg:min-w-0"
          >
            {labels.print}
          </button>
        )}
        <button
          type="button"
          disabled={selectedCount === 0 || cancelling}
          onClick={onCancel}
          aria-label={labels.cancel}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-er hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40 lg:min-h-0 lg:min-w-0"
        >
          {cancelling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {labels.cancel}
        </button>
      </div>
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
    <div
      className={cn(
        "flex min-w-0 items-stretch",
        selected && "bg-primary-50/50 dark:bg-primary-950/20",
      )}
    >
      <div className="shrink-0 p-3 pr-0 pt-3">
        <OrderSelectionCheckbox
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          label={order.code}
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="min-h-11 min-w-11 flex-1 p-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-primary-600">{order.code}</div>
            <div className="break-words text-xs text-slate-400">
              {formatDate(order.createdAt)} ·{" "}
              {order.customerName ?? labels.walkIn} ·{" "}
              {channelLabel(order.sourceMode)}
            </div>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold tabular-nums">
            {formatCurrency(Number(order.total))}
          </span>
          {remaining > 0 && order.status !== "cancelled" ? (
            <span className="text-right font-semibold tabular-nums text-er">
              {labels.remaining}: {formatCurrency(remaining)}
            </span>
          ) : (
            <PaymentStatusBadge status={order.paymentStatus} />
          )}
        </div>
      </button>
    </div>
  );
}

export function OrdersTable({
  rows,
  printTemplates,
  selection,
}: {
  rows: OrderListRow[];
  printTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  selection?: {
    selectedIds: Set<string>;
    onChange: (next: Set<string>) => void;
  };
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [cancelling, startCancelTransition] = useTransition();
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const selectedIds = selection?.selectedIds ?? internalSelectedIds;
  const setSelectedIds = selection?.onChange ?? setInternalSelectedIds;
  const selectableIds = rows
    .filter((order) => order.status !== "cancelled")
    .map((order) => order.id);
  const normalizedSelection = normalizeOrderBatchSelection(
    selectedIds,
    selectableIds,
  );
  const selectedVisibleIds = [...normalizedSelection];
  const targetIds = selectableIds;
  const allSelected =
    targetIds.length > 0 &&
    targetIds.every((id) => normalizedSelection.has(id));

  function toggle(orderId: string) {
    setSelectedIds(
      toggleOrderBatchSelection(normalizedSelection, orderId, selectableIds),
    );
  }

  function toggleAll() {
    setSelectedIds(
      toggleAllOrderBatchSelection(normalizedSelection, selectableIds),
    );
  }

  function openOrder(order: OrderListRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("detailOrderId", order.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  async function cancelSelectedOrders() {
    const ids = selectedVisibleIds;
    if (ids.length === 0 || cancelling) return;
    const confirmed = await dialog.confirm({
      title: t("orders.bulkCancel.title"),
      description: t("orders.bulkCancel.description", { count: ids.length }),
      confirmLabel: t("orders.cancelSelected"),
      variant: "destructive",
    });
    if (!confirmed) return;

    startCancelTransition(async () => {
      const result = await cancelOrders(ids);
      if (!result.ok) {
        await dialog.alert({
          description: t(result.error as never),
          variant: "destructive",
        });
        return;
      }

      const failed = new Set(result.data.failedIds);
      setSelectedIds(failed);
      router.refresh();
      await dialog.alert({
        title: t("orders.bulkCancel.resultTitle"),
        description:
          failed.size === 0
            ? t("orders.bulkCancel.success", { count: result.data.cancelled })
            : result.data.cancelled > 0
              ? t("orders.bulkCancel.partial", {
                  cancelled: result.data.cancelled,
                  failed: failed.size,
                })
              : t("orders.bulkCancel.failed", { count: failed.size }),
        variant: failed.size > 0 ? "warning" : "default",
      });
    });
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
          checked={normalizedSelection.has(order.id)}
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
      render: (order) => (
        <span className="font-semibold text-primary-600">{order.code}</span>
      ),
    },
    {
      key: "date",
      label: t("orders.cols.date"),
      defaultVisible: true,
      width: "160px",
      render: (order) => (
        <span className="text-slate-500">{formatDate(order.createdAt)}</span>
      ),
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
      render: (order) => (
        <span className="text-slate-500">{order.projectName ?? "—"}</span>
      ),
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
        return remaining > 0 && order.status !== "cancelled"
          ? "font-semibold text-er"
          : "text-slate-400";
      },
      render: (order) => {
        const remaining = Number(order.total) - Number(order.amountPaid);
        return remaining > 0 && order.status !== "cancelled"
          ? formatCurrency(remaining)
          : "—";
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
        rowClassName={(order) =>
          cn(
            order.status === "cancelled" && "opacity-60",
            normalizedSelection.has(order.id) &&
              "bg-primary-50/50 dark:bg-primary-950/20",
          )
        }
        toolbar={
          <OrderBatchToolbar
            selectedCount={selectedVisibleIds.length}
            selectedIds={selectedVisibleIds}
            templates={printTemplates}
            cancelling={cancelling}
            onCancel={cancelSelectedOrders}
            labels={{
              merge: t("merge.title"),
              print: t("orders.printSelected"),
              cancel: t("orders.cancelSelected"),
              selected: t("orders.selectedCount", {
                count: selectedVisibleIds.length,
              }),
            }}
          />
        }
        toolbarFloating
        empty={(
          <SalesTableEmptyState
            icon={FileX2}
            title={t("orders.empty")}
          />
        )}
        renderMobileRow={({ row: order }) => (
          <OrderMobileRow
            order={order}
            selected={normalizedSelection.has(order.id)}
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
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-bold",
        online ? "bg-warn-soft text-warn" : "bg-surface-2 text-slate-600",
      )}
    >
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
