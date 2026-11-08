"use client";

import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
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
import { ChevronDown, FileX2, Loader2, Printer, XCircle } from "lucide-react";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { cancelOrders } from "@/lib/actions/orders";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { controlHeightClassName } from "@/components/ui/button-variants";
import { mobileDocumentDayHeadings } from "./mobile-document-day";

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
      <Checkbox
        ref={ref}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        onClick={stopRowToggle}
        aria-label={label}
        className="h-4 w-4"
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
  const mergeHref = `/orders/merge?${selectedIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&")}`;
  return (
    <div className="flex w-full items-center justify-end gap-2 text-sm">
      <span
        className="px-2 py-1 text-xs font-semibold text-slate-600"
        aria-live="polite"
      >
        {labels.selected ?? selectedCount}
      </span>
      <div className="grid grid-cols-2 gap-2 lg:contents">
        {selectedCount < 2 ? (
          <button
            type="button"
            disabled
            className={`${controlHeightClassName} inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-3 text-xs font-semibold opacity-50 disabled:cursor-not-allowed lg:min-h-0 lg:min-w-0 lg:text-sm`}
          >
            {labels.merge}
          </button>
        ) : (
          <Link
            href={mergeHref}
            className={`${controlHeightClassName} inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-2 lg:min-h-0 lg:min-w-0 lg:text-sm`}
          >
            {labels.merge}
          </Link>
        )}
        {selectedCount > 0 ? (
          <PrintTemplateMenu
            baseHref={batchHref}
            templates={templates}
            label={labels.print}
            className={`${controlHeightClassName} min-h-11 min-w-11 justify-center rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-2 lg:min-h-0 lg:min-w-0 lg:text-sm`}
          />
        ) : (
          <button
            type="button"
            disabled
            className={`${controlHeightClassName} inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold opacity-50 lg:min-h-0 lg:min-w-0 lg:text-sm`}
          >
            <Printer className="h-4 w-4" />
            {labels.print}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          disabled={selectedCount === 0 || cancelling}
          onClick={onCancel}
          aria-label={labels.cancel}
          className={`${controlHeightClassName} inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-er hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40 lg:min-h-0 lg:min-w-0 lg:text-sm`}
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
  dayHeading,
}: {
  order: OrderListRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  labels: {
    walkIn: string;
    remaining: string;
  };
  dayHeading?: string;
}) {
  const remaining = Number(order.total) - Number(order.amountPaid);
  const selectable = order.status !== "cancelled" && order.status !== "merged";
  const customerTitle = order.customerName ?? labels.walkIn;
  return (
    <div>
      {dayHeading && (
        <div className="border-b border-border-soft bg-surface-2/60 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300" role="heading" aria-level={3}>
          {dayHeading}
        </div>
      )}
    <div className={cn(
      "flex min-w-0 items-stretch",
      selected && "bg-primary-50/50 dark:bg-primary-950/20",
    )}>
      <div className="shrink-0 p-3 pr-0 pt-3">
        <OrderSelectionCheckbox
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          label={order.code}
        />
      </div>
      <div className="relative min-h-[104px] min-w-0 flex-1 p-3 text-left">
        {/* The transparent button covers the whole row, not just its title. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${customerTitle} · ${order.code}`}
          className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-primary-500"
        />
        <div className="pointer-events-none relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <PartnerDetailLink
              kind="customer"
              partnerId={order.customerId}
              name={customerTitle}
              openInCurrentTab
              className="pointer-events-auto relative block truncate text-[15px] font-semibold text-foreground"
            />
          </div>
          <span className="min-w-0 max-w-[48%] shrink-0 text-right text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere]">
            {formatCurrency(Number(order.total))}
          </span>
        </div>
        <div className="pointer-events-none relative mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          {selectable && remaining > 0 && (
            <span className="font-medium tabular-nums text-er">
              {labels.remaining}: {formatCurrency(remaining)}
            </span>
          )}
        </div>
        <div className="pointer-events-none relative mt-2 truncate text-[11px] text-slate-500 dark:text-slate-400">
          {formatDate(order.createdAt)} · {order.code} · {channelLabel(order.sourceMode)}
        </div>
      </div>
    </div>
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
  const dayHeadings = mobileDocumentDayHeadings(rows, (order) => order.createdAt);
  const selectableIds = rows
    .filter((order) => order.status !== "cancelled" && order.status !== "merged")
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
          disabled={order.status === "cancelled" || order.status === "merged"}
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
      wrap: true,
      render: (order) => <PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} openInCurrentTab className="whitespace-normal break-words" />,
    },
    {
      key: "project",
      label: t("orders.cols.project"),
      defaultVisible: false,
      wrap: true,
      render: (order) => (
        <span className="whitespace-normal break-words text-slate-500">{order.projectName ?? "—"}</span>
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
        return remaining > 0 && order.status !== "cancelled" && order.status !== "merged"
          ? "font-semibold text-er"
          : "text-slate-400";
      },
      render: (order) => {
        const remaining = Number(order.total) - Number(order.amountPaid);
        return remaining > 0 && order.status !== "cancelled" && order.status !== "merged"
          ? formatCurrency(remaining)
          : "—";
      },
    },
    {
      key: "payment",
      label: t("orders.cols.payment"),
      defaultVisible: true,
      width: "130px",
      render: (order) => order.status === "cancelled" || order.status === "merged"
        ? <span className="text-slate-400">—</span>
        : <PaymentStatusBadge status={order.paymentStatus} />,
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
        minWidth="1010px"
        onRowClick={openOrder}
        rowClickMode="row"
        rowClassName={(order) =>
          cn(
            (order.status === "cancelled" || order.status === "merged") && "opacity-60",
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
            dayHeading={dayHeadings.get(order.id)}
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

function channelLabel(source?: string | null) {
  if (source === "shopee") return "Shopee";
  if (source === "tiktok_shop") return "TikTok Shop";
  if (source === "lazada") return "Lazada";
  if (source === "tiki") return "Tiki";
  return "POS";
}
