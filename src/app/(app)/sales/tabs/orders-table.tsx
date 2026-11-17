"use client";

import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { CheckCircle2, ChevronDown, Circle, FileX2, Loader2, Printer, XCircle } from "lucide-react";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { cancelOrders } from "@/lib/actions/orders";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { controlHeightClassName } from "@/components/ui/button-variants";
import { mobileDocumentDayGroups, mobileDocumentTimestamp, type MobileDocumentDayGroup } from "./mobile-document-day";
import { MobileDocumentRow } from "./mobile-document-row";

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
  mobileSelecting = false,
  onDone,
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
    done?: string;
  };
  /** Phones show batch actions only after a long press enters selection mode (iOS). */
  mobileSelecting?: boolean;
  onDone?: () => void;
}) {
  const batchHref = `/orders/print-batch?${selectedIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&")}`;
  const mergeHref = `/orders/merge?${selectedIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&")}`;
  return (
    <div className={cn("w-full flex-wrap items-center justify-end gap-2 text-sm", mobileSelecting ? "flex" : "hidden lg:flex")}>
      <span
        className="px-2 py-1 text-xs font-semibold text-slate-600 max-lg:mr-auto"
        aria-live="polite"
      >
        {labels.selected ?? selectedCount}
      </span>
      {onDone && labels.done && (
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 px-2 text-[17px] font-semibold text-ios-accent lg:hidden"
        >
          {labels.done}
        </button>
      )}
      <div className="grid w-full grid-cols-3 gap-2 lg:contents">
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

/** Status line copy from NativeInvoiceHistoryRow.statusLabel. */
export function orderMobileStatusKey(status: string, paymentStatus: string) {
  switch (status) {
    case "draft": return "draft";
    case "quote": return "quote";
    case "confirmed": return "booked";
    case "delivering": return "delivering";
    case "completed": return paymentStatus === "paid" ? "paid" : "due";
    case "returned": return "returned";
    case "cancelled": return "cancelled";
    case "merged": return "merged";
    default: return "pending";
  }
}

export function OrderMobileRow({
  order,
  selecting,
  selected,
  onToggle,
  onOpen,
  onLongPress,
  labels,
  dayGroup,
  timestamp,
}: {
  order: OrderListRow;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onLongPress: () => void;
  labels: {
    walkIn: string;
    status: string;
    itemSummary: string | null;
    select: string;
  };
  dayGroup?: MobileDocumentDayGroup;
  timestamp: string;
}) {
  const selectable = order.status !== "cancelled" && order.status !== "merged";
  const customerTitle = order.customerName ?? labels.walkIn;
  const Indicator = selected ? CheckCircle2 : Circle;
  return (
    <MobileDocumentRow
      customerName={customerTitle}
      customer={(
        <PartnerDetailLink
          kind="customer"
          partnerId={selecting ? null : order.customerId}
          name={customerTitle}
          openInCurrentTab
          className="pointer-events-auto relative -my-3 block truncate py-3 text-foreground"
        />
      )}
      dayGroup={dayGroup}
      amount={formatCurrency(Number(order.total))}
      status={labels.status}
      details={labels.itemSummary}
      code={order.code}
      createdAt={timestamp}
      selected={selected}
      leading={selecting ? (
        <button
          type="button"
          onClick={onToggle}
          disabled={!selectable}
          aria-pressed={selected}
          aria-label={`${labels.select} ${order.code}`}
          data-button-radius="pill"
          className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40"
        >
          <Indicator className={cn("size-6", selected ? "fill-ios-accent text-white dark:text-black" : "text-ios-label-tertiary")} strokeWidth={selected ? 2.4 : 1.8} aria-hidden="true" />
        </button>
      ) : undefined}
      onOpen={selecting ? onToggle : onOpen}
      onLongPress={selectable ? onLongPress : undefined}
    />
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
  const locale = useLocale();
  const [selecting, setSelecting] = useState(false);
  const dayGroups = mobileDocumentDayGroups(rows, (order) => order.createdAt, (order) => Number(order.total), {
    locale,
    today: (date) => t("mobile.invoices.groupToday", { date }),
    yesterday: (date) => t("mobile.invoices.groupYesterday", { date }),
    summary: (count, total) => t("mobile.invoices.groupSummary", { count, total }),
  });
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
            mobileSelecting={selecting}
            onDone={() => {
              setSelecting(false);
              setSelectedIds(new Set());
            }}
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
              done: t("mobile.invoices.selectDone"),
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
        mobileListClassName="-mx-4 space-y-0 border-t border-border bg-surface"
        mobileRowClassName="!rounded-none !border-0"
        renderMobileRow={({ row: order }) => (
          <OrderMobileRow
            order={order}
            dayGroup={dayGroups.get(order.id)}
            timestamp={mobileDocumentTimestamp(order.createdAt, locale)}
            selecting={selecting}
            selected={normalizedSelection.has(order.id)}
            onToggle={() => toggle(order.id)}
            onOpen={() => openOrder(order)}
            onLongPress={() => {
              setSelecting(true);
              if (!normalizedSelection.has(order.id)) toggle(order.id);
            }}
            labels={{
              walkIn: t("orders.walkIn"),
              status: t(`mobile.invoices.status.${orderMobileStatusKey(order.status, order.paymentStatus)}`),
              itemSummary: orderItemSummary(order, t),
              select: t("mobile.invoices.select"),
            }}
          />
        )}
      />
    </form>
  );
}

function orderItemSummary(order: OrderListRow, t: ReturnType<typeof useTranslations>) {
  const names = order.productNames?.replaceAll(" {DEL}", " (DEL)").trim() || null;
  if (order.itemCount <= 0) return names;
  return names
    ? t("mobile.invoices.itemSummary", { count: order.itemCount, names })
    : t("mobile.invoices.itemCount", { count: order.itemCount });
}
