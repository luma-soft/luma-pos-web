"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Fragment, isValidElement, type ReactNode, type SyntheticEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Columns3, X } from "lucide-react";
import { cn } from "@/lib/utils";

type SortValue = string | number | Date | null | undefined;
type SortDirection = "asc" | "desc";

export type DataTableColumn<T> = {
  key: string;
  label: ReactNode;
  required?: boolean;
  defaultVisible?: boolean;
  align?: "left" | "right" | "center";
  width?: string;
  headerClassName?: string;
  cellClassName?: string | ((row: T) => string | undefined);
  render: (row: T) => ReactNode;
  mobileRender?: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => SortValue;
};

export type DataTableSummaryCell = {
  key: string;
  content?: ReactNode;
  className?: string;
};

type MobileRenderProps<T> = {
  row: T;
  expanded: boolean;
  toggle: () => void;
};

export function stopRowToggle(event: SyntheticEvent) {
  event.stopPropagation();
}

export function resetDataTableScroll(region: { scrollTop: number }) {
  region.scrollTop = 0;
}

export function dataTableResultSetKey(
  searchParams: { toString: () => string },
  expandedParam: string,
) {
  const resultSetParams = new URLSearchParams(searchParams.toString());
  resultSetParams.delete(expandedParam);
  return resultSetParams.toString();
}

const NON_SORTABLE_COLUMN_KEYS = new Set(["select", "action", "actions", "menu"]);
const SORT_KEY_ALIASES: Record<string, string[]> = {
  actor: ["actorName", "createdByName"],
  assets: ["assetCount"],
  assignee: ["assigneeName", "assignedToName"],
  beforeVat: ["totalBeforeVat"],
  buyer: ["buyerName", "customerName"],
  cashier: ["cashierName", "createdByName"],
  category: ["categoryName"],
  claims: ["openClaimCount", "claimCount"],
  closed: ["closedAt"],
  collected: ["collectedAmount", "amountPaid"],
  cost: ["totalCost", "costPrice"],
  counted: ["countedCash"],
  createdBy: ["createdByName"],
  customer: ["customerName"],
  date: ["createdAt", "date"],
  daysLeft: ["daysOfStock"],
  debt: ["currentDebt", "debt", "owed"],
  delivery: ["deliveryDate"],
  diff: ["totalDiff"],
  employee: ["employeeName", "fullName"],
  expected: ["expectedCash"],
  items: ["itemCount"],
  jobs: ["jobCount", "openJobCount"],
  lastPurchase: ["lastPurchasePrice"],
  min: ["minLevel"],
  netSales: ["totalSpent", "netSales"],
  onHand: ["stock", "totalStock"],
  opened: ["openedAt"],
  order: ["orderCode", "code"],
  orders: ["orderCount"],
  product: ["productName", "name"],
  profit: ["grossProfit", "profit"],
  reported: ["reportedAt"],
  revenue: ["totalRevenue", "revenue"],
  salePrice: ["retailPrice"],
  schedule: ["scheduledAt"],
  stock: ["totalStock", "stock"],
  suggested: ["suggestedQty"],
  supplier: ["supplierName"],
  tax: ["taxCode", "tax"],
  time: ["createdAt", "time"],
  uncollected: ["uncollectedAmount", "remaining"],
  value: ["totalValue", "stockValue", "total"],
  variance: ["cashVariance", "variance"],
  vat: ["vatAmount"],
  warehouse: ["warehouseName"],
};
const sortCollator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

function isSortableColumn<T>(column: DataTableColumn<T>) {
  return column.sortable ?? !NON_SORTABLE_COLUMN_KEYS.has(column.key);
}

function getColumnSortValue<T>(column: DataTableColumn<T>, row: T): SortValue {
  if (column.sortValue) return column.sortValue(row);

  const record = row as Record<string, unknown>;
  const candidateKeys = [column.key, ...(SORT_KEY_ALIASES[column.key] ?? [])];
  for (const key of candidateKeys) {
    const candidate = record[key];
    if (candidate instanceof Date || typeof candidate === "string" || typeof candidate === "number") {
      return candidate;
    }
  }

  return extractNodeText(column.render(row));
}

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractNodeText(node.props.children);
  return "";
}

function normalizeSortValue(value: SortValue): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isNaN(value) ? null : value;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (/[₫đ]/i.test(trimmed)) {
    const numeric = Number(trimmed.replace(/[^\d-]/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  if (trimmed.includes("%")) {
    const numeric = Number(trimmed.replace(/[^\d,.-]/g, "").replace(",", "."));
    if (Number.isFinite(numeric)) return numeric;
  }
  return trimmed;
}

function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection) {
  const left = normalizeSortValue(a);
  const right = normalizeSortValue(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const compared = typeof left === "number" && typeof right === "number"
    ? left - right
    : sortCollator.compare(String(left), String(right));
  return direction === "asc" ? compared : -compared;
}

export function DataTableShell<T>({
  tableId,
  rows,
  columns,
  getRowId,
  renderExpanded,
  renderDetail,
  detailTitle,
  detailSubtitle,
  detailFooter,
  detailSize = "xl",
  detailBodyClassName,
  renderMobileRow,
  mobileListClassName,
  mobileRowClassName,
  summaryCells,
  minWidth = "980px",
  expandedParam = "expanded",
  initialExpandedId,
  empty,
  rowClassName,
  onRowClick,
  toolbar,
  toolbarFloating = false,
  visibleColumnKeys,
  onColumnVisibilityChange,
  maxHeight = "calc(100dvh - 250px)",
  minHeight = 280,
  fillHeight = true,
  canExpand,
  resetScrollKey,
}: {
  tableId: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  /** Chỉ dùng cho nội dung phân cấp nằm ngay dưới dòng (ví dụ nhóm hàng cha-con). */
  renderExpanded?: (row: T) => ReactNode;
  /** Nội dung xem chi tiết của dòng; luôn hiển thị trong modal. */
  renderDetail?: (row: T) => ReactNode;
  detailTitle?: (row: T) => ReactNode;
  detailSubtitle?: (row: T) => ReactNode;
  detailFooter?: (row: T) => ReactNode;
  detailSize?: "md" | "lg" | "xl" | "full";
  detailBodyClassName?: string;
  renderMobileRow?: (props: MobileRenderProps<T>) => ReactNode;
  mobileListClassName?: string;
  mobileRowClassName?: string;
  summaryCells?: DataTableSummaryCell[];
  minWidth?: string;
  expandedParam?: string;
  initialExpandedId?: string | null;
  empty?: ReactNode;
  rowClassName?: (row: T, expanded: boolean) => string | undefined;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  /** Đặt toolbar ở góc trên bảng mà không chiếm chiều cao dòng (desktop). */
  toolbarFloating?: boolean;
  /** Điều khiển hiển thị cột từ UI bên ngoài bảng (ví dụ chip bảng giá). */
  visibleColumnKeys?: Set<string>;
  /** Đồng bộ thay đổi từ menu chọn cột về UI bên ngoài. */
  onColumnVisibilityChange?: (keys: Set<string>) => void;
  maxHeight?: string;
  /** Minimum desktop scroll-region height when fillHeight is enabled. */
  minHeight?: number;
  fillHeight?: boolean;
  canExpand?: (row: T) => boolean;
  /** Identifies a new result set whose first row should become visible. */
  resetScrollKey?: string | number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const desktopTableRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  const storageKey = `luma:${tableId}:columns`;
  const queryExpanded = params.get(expandedParam);
  const expandedId = queryExpanded ?? initialExpandedId ?? null;
  const [storedVisible, setStoredVisible] = useState<Set<string> | null>(null);
  const [activeSortColumn, setActiveSortColumn] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const queryResultSetKey = dataTableResultSetKey(params, expandedParam);
  const effectiveResetScrollKey = resetScrollKey ?? queryResultSetKey;

  useLayoutEffect(() => {
    if (desktopTableRef.current) resetDataTableScroll(desktopTableRef.current);
  }, [effectiveResetScrollKey, sort]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const next = new Set(parsed.filter((key) => typeof key === "string"));
          setStoredVisible(next);
          onColumnVisibilityChange?.(next);
        }
      } catch {
        setStoredVisible(null);
      }
    });
    return () => {
      active = false;
    };
  }, [onColumnVisibilityChange, storageKey]);

  useEffect(() => {
    if (!visibleColumnKeys) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleColumnKeys)));
    } catch {
      // Non-critical preference; ignore storage failures.
    }
  }, [storageKey, visibleColumnKeys]);

  useEffect(() => {
    if (!fillHeight || !maxHeight) return;
    const updateHeight = () => {
      const top = desktopTableRef.current?.getBoundingClientRect().top ?? 0;
      // Reserve only the pagination row and a small bottom inset. The app shell
      // constrains the viewport, so a large safety gap would leave visible
      // whitespace below every table.
      setAvailableHeight(Math.max(minHeight, Math.floor(window.innerHeight - top - 96)));
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [fillHeight, maxHeight, minHeight]);

  const defaultVisible = useMemo(
    () => new Set(columns.filter((column) => column.required || column.defaultVisible !== false).map((column) => column.key)),
    [columns],
  );

  const visibleKeys = visibleColumnKeys ?? storedVisible ?? defaultVisible;
  const visibleColumns = columns.filter((column) => column.required || visibleKeys.has(column.key));
  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column || !isSortableColumn(column)) return rows;

    return rows
      .map((row, index) => ({ row, index, value: getColumnSortValue(column, row) }))
      .sort((a, b) => {
        const compared = compareSortValues(a.value, b.value, sort.direction);
        return compared === 0 ? a.index - b.index : compared;
      })
      .map(({ row }) => row);
  }, [columns, rows, sort]);
  const selectedDetailRow = renderDetail
    ? displayRows.find((row) => getRowId(row) === expandedId) ?? null
    : null;

  function persist(next: Set<string>) {
    const normalized = new Set(next);
    for (const column of columns) if (column.required) normalized.add(column.key);
    setStoredVisible(normalized);
    onColumnVisibilityChange?.(normalized);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(normalized)));
    } catch {
      // Non-critical preference; ignore storage failures.
    }
  }

  function toggleColumn(key: string) {
    const column = columns.find((item) => item.key === key);
    if (!column || column.required) return;
    const next = new Set(visibleKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  }

  function resetColumns() {
    setStoredVisible(defaultVisible);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  function setExpanded(nextId: string | null) {
    if (!renderExpanded && !renderDetail) return;
    const sp = new URLSearchParams(params.toString());
    if (nextId) sp.set(expandedParam, nextId);
    else sp.delete(expandedParam);
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const columnVisibilityMenu = (
    <ColumnVisibilityMenu
      columns={columns}
      visibleKeys={visibleKeys}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onToggle={toggleColumn}
      onReset={resetColumns}
    />
  );

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-col">
      {toolbar && <div className={cn("mb-2 flex flex-wrap items-center justify-end gap-2", toolbarFloating && "lg:absolute lg:-top-[65px] lg:right-0 lg:mb-0")}>{toolbar}</div>}

      {rows.length === 0 && empty ? (
        <div
          ref={desktopTableRef}
          className={cn(
            "min-h-[280px] [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:flex-col [&>*]:items-center [&>*]:justify-center",
            fillHeight && "h-full",
          )}
          style={maxHeight ? {
            maxHeight: availableHeight ? `${availableHeight}px` : maxHeight,
            ...(fillHeight ? { height: availableHeight ? `${availableHeight}px` : maxHeight } : {}),
          } : undefined}
        >
          {empty}
        </div>
      ) : (
        <>
          <div className={cn("space-y-2 lg:hidden", mobileListClassName)}>
            {displayRows.map((row) => {
              const id = getRowId(row);
              const expandable = Boolean(!onRowClick && renderExpanded && (canExpand ? canExpand(row) : true));
              const detailOpenable = Boolean(!onRowClick && renderDetail && (canExpand ? canExpand(row) : true));
              const expanded = (expandable || detailOpenable) && expandedId === id;
              const toggle = () => {
                if (expandable || detailOpenable) setExpanded(expanded ? null : id);
              };
              return (
                <div
                  key={id}
                  className={cn(
                    "overflow-hidden rounded-card border bg-surface",
                    expanded ? "border-primary-200 shadow-e1" : "border-border-soft",
                    mobileRowClassName,
                  )}
                >
                  {renderMobileRow ? (
                    renderMobileRow({ row, expanded, toggle })
                  ) : (
                    <button type="button" onClick={() => onRowClick ? onRowClick(row) : toggle()} className="min-h-11 w-full p-3 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          {visibleColumns.slice(0, 3).map((column) => (
                            <div key={column.key} className={cn("truncate", column.align === "right" && "text-right")}>
                              {column.mobileRender ? column.mobileRender(row) : column.render(row)}
                            </div>
                          ))}
                        </div>
                        {expandable && <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />}
                      </div>
                    </button>
                  )}
                  {expanded && renderExpanded && <div className="border-t border-border-soft">{renderExpanded(row)}</div>}
                </div>
              );
            })}
          </div>

          <div
            ref={desktopTableRef}
            className={cn(
              "hidden min-h-0 rounded-card border border-border-soft bg-surface lg:block",
              maxHeight ? "data-table-scroll-region overflow-auto [scrollbar-gutter:stable]" : "overflow-x-auto",
              fillHeight && "h-full",
            )}
            style={maxHeight ? { maxHeight: availableHeight ? `${availableHeight}px` : maxHeight, ...(fillHeight ? { height: availableHeight ? `${availableHeight}px` : maxHeight } : {}) } : undefined}
          >
            <table className="w-full table-fixed text-sm" style={{ minWidth }}>
              <colgroup>
                {visibleColumns.map((column) => (
                  <col key={column.key} style={column.width ? { width: column.width } : undefined} />
                ))}
                <col style={{ width: "44px" }} />
              </colgroup>
              <thead>
                <tr className="bg-canvas text-left text-xs font-semibold text-slate-500 dark:text-slate-300">
                  {visibleColumns.map((column) => {
                    const sortable = isSortableColumn(column);
                    const controlsVisible = sortable && activeSortColumn === column.key;
                    const direction = sort?.key === column.key ? sort.direction : null;
                    return (
                      <th
                        key={column.key}
                        aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                        className={cn(
                          "px-3 py-3",
                          maxHeight && "sticky top-0 z-10 bg-canvas",
                          controlsVisible && "bg-primary-50/70 dark:bg-primary-950/25",
                          column.align === "right" && "text-right",
                          column.align === "center" && "text-center",
                          column.headerClassName,
                        )}
                      >
                        {sortable ? (
                          <div className={cn(
                            "relative flex min-w-0 items-center gap-1.5",
                            column.align === "right" && "flex-row-reverse justify-start",
                            column.align === "center" && "justify-center",
                          )}>
                            <button
                              type="button"
                              onClick={() => {
                                if (activeSortColumn === column.key) {
                                  setActiveSortColumn(null);
                                  setSort(null);
                                  return;
                                }
                                setActiveSortColumn(column.key);
                                if (sort?.key !== column.key) setSort(null);
                              }}
                              className="min-w-0 truncate text-inherit hover:text-slate-900 dark:hover:text-white"
                            >
                              {column.label}
                            </button>
                            <span className={cn(
                              "inline-flex h-4 w-4 shrink-0 flex-col items-center justify-center",
                              column.align === "center" && "absolute right-0",
                            )}>
                              {controlsVisible && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setSort({ key: column.key, direction: "asc" })}
                                    className={cn("grid h-2 w-4 place-items-center text-slate-300 transition-colors hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300", direction === "asc" && "text-primary-600 dark:text-primary-400")}
                                    aria-label="Sort ascending"
                                    title="Sort ascending"
                                  >
                                    <ChevronUp className="h-3 w-3 stroke-[2.5]" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSort({ key: column.key, direction: "desc" })}
                                    className={cn("grid h-2 w-4 place-items-center text-slate-300 transition-colors hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300", direction === "desc" && "text-primary-600 dark:text-primary-400")}
                                    aria-label="Sort descending"
                                    title="Sort descending"
                                  >
                                    <ChevronDown className="h-3 w-3 stroke-[2.5]" />
                                  </button>
                                </>
                              )}
                            </span>
                          </div>
                        ) : column.label}
                      </th>
                    );
                  })}
                  <th className="sticky right-0 top-0 z-20 bg-canvas px-2 py-2 text-right shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)]">{columnVisibilityMenu}</th>
                </tr>
              </thead>
              <tbody>
                {summaryCells && (
                  <tr className="border-t border-border-soft bg-surface text-right font-bold tabular-nums">
                    {visibleColumns.map((column) => {
                      const cell = summaryCells.find((item) => item.key === column.key);
                      return <td key={column.key} className={cn("px-3 py-3", cell?.className)}>{cell?.content}</td>;
                    })}
                    <td className="sticky right-0 z-10 bg-surface px-3 py-3" />
                  </tr>
                )}
                {displayRows.map((row) => {
                  const id = getRowId(row);
                  const expandable = Boolean(!onRowClick && renderExpanded && (canExpand ? canExpand(row) : true));
                  const detailOpenable = Boolean(!onRowClick && renderDetail && (canExpand ? canExpand(row) : true));
                  const expanded = (expandable || detailOpenable) && expandedId === id;
                  return (
                    <Fragment key={id}>
                      <tr
                        className={cn(
                          "border-t border-border-soft transition-colors",
                          (expandable || detailOpenable || onRowClick) && "cursor-pointer",
                          expanded ? "bg-primary-50/45 dark:bg-primary-950/15" : "hover:bg-surface-2",
                          rowClassName?.(row, expanded),
                        )}
                        onClick={() => {
                          if (onRowClick) onRowClick(row);
                          else if (expandable || detailOpenable) setExpanded(expanded ? null : id);
                        }}
                      >
                        {visibleColumns.map((column) => {
                          const cellClassName = typeof column.cellClassName === "function" ? column.cellClassName(row) : column.cellClassName;
                          return (
                            <td
                              key={column.key}
                              className={cn(
                                "truncate px-3 py-3 align-middle",
                                column.align === "right" && "text-right tabular-nums",
                                column.align === "center" && "text-center",
                                cellClassName,
                              )}
                            >
                              {column.render(row)}
                            </td>
                          );
                        })}
                        <td className="sticky right-0 z-10 bg-surface px-3 py-3 text-right shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.25)]">
                          {expandable && (
                            <ChevronDown className={cn("ml-auto h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
                          )}
                        </td>
                      </tr>
                      {expanded && renderExpanded && (
                        <tr className="border-t border-border-soft">
                          <td colSpan={visibleColumns.length + 1} className="p-0">
                            {renderExpanded(row)}
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
      )}
      {selectedDetailRow && renderDetail && (
        <RowPreviewModal
          open
          onClose={() => setExpanded(null)}
          title={detailTitle?.(selectedDetailRow) ?? columns[0]?.render(selectedDetailRow) ?? "Chi tiết"}
          subtitle={detailSubtitle?.(selectedDetailRow)}
          footer={detailFooter?.(selectedDetailRow)}
          size={detailSize}
          bodyClassName={detailBodyClassName}
        >
          {renderDetail(selectedDetailRow)}
        </RowPreviewModal>
      )}
    </div>
  );
}

function ColumnVisibilityMenu<T>({
  columns,
  visibleKeys,
  open,
  onOpenChange,
  onToggle,
  onReset,
}: {
  columns: DataTableColumn<T>[];
  visibleKeys: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (key: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="relative inline-flex justify-end" onClick={stopRowToggle}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/75 hover:text-slate-800 dark:hover:bg-slate-900/50 dark:hover:text-slate-100",
          open && "bg-white text-primary-700 shadow-sm dark:bg-slate-900 dark:text-primary-300",
        )}
        aria-label="Chọn cột hiển thị"
        title="Chọn cột hiển thị"
      >
        <Columns3 className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" aria-label="Đóng chọn cột" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-[300px] rounded-card border border-border-soft bg-surface p-3 text-left shadow-e2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Thông tin hiển thị</div>
              <button type="button" onClick={() => onOpenChange(false)} className="rounded-md p-1 text-slate-400 hover:bg-surface-2 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid max-h-[420px] gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {columns.map((column) => {
                const checked = column.required || visibleKeys.has(column.key);
                return (
                  <label
                    key={column.key}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium",
                      column.required ? "text-slate-400" : "cursor-pointer text-slate-600 hover:bg-surface-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={column.required}
                      onChange={() => onToggle(column.key)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{column.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 border-t border-border-soft pt-2 text-right">
              <button type="button" onClick={onReset} className="text-xs font-medium text-primary-600 hover:underline">
                Đặt lại mặc định
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function RowPreviewModal({
  title,
  subtitle,
  open,
  onClose,
  children,
  footer,
  size = "full",
  closeLabel = "Đóng",
  bodyClassName,
  panelClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl" | "full";
  closeLabel?: string;
  bodyClassName?: string;
  panelClassName?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-card",
          size === "md" && "max-h-[92dvh] sm:max-w-lg",
          size === "lg" && "max-h-[92dvh] sm:max-w-2xl",
          size === "xl" && "max-h-[92dvh] sm:max-w-4xl",
          size === "full" && "h-full max-h-[900px] sm:max-w-6xl",
          panelClassName,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div id={titleId} className="truncate text-lg font-bold">{title}</div>
            {subtitle && <div className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 lg:h-9 lg:w-9" aria-label={closeLabel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto p-4 sm:p-5", bodyClassName)}>{children}</div>
        {footer && <div className="shrink-0 border-t border-border-soft px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">{footer}</div>}
      </div>
    </div>
  );
}
