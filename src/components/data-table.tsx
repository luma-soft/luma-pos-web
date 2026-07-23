"use client";

import { Fragment, type ReactNode, type SyntheticEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Columns3, X } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function DataTableShell<T>({
  tableId,
  rows,
  columns,
  getRowId,
  renderExpanded,
  renderMobileRow,
  summaryCells,
  minWidth = "980px",
  expandedParam = "expanded",
  initialExpandedId,
  empty,
  rowClassName,
  toolbar,
  maxHeight = "calc(100dvh - 250px)",
  fillHeight = true,
  canExpand,
}: {
  tableId: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  renderExpanded?: (row: T) => ReactNode;
  renderMobileRow?: (props: MobileRenderProps<T>) => ReactNode;
  summaryCells?: DataTableSummaryCell[];
  minWidth?: string;
  expandedParam?: string;
  initialExpandedId?: string | null;
  empty?: ReactNode;
  rowClassName?: (row: T, expanded: boolean) => string | undefined;
  toolbar?: ReactNode;
  maxHeight?: string;
  fillHeight?: boolean;
  canExpand?: (row: T) => boolean;
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

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setStoredVisible(new Set(parsed.filter((key) => typeof key === "string")));
      } catch {
        setStoredVisible(null);
      }
    });
    return () => {
      active = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!fillHeight || !maxHeight) return;
    const updateHeight = () => {
      const top = desktopTableRef.current?.getBoundingClientRect().top ?? 0;
      // Keep a compact footer-sized gap so pagination stays visible below the table.
      setAvailableHeight(Math.max(280, Math.floor(window.innerHeight - top - 72)));
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [fillHeight, maxHeight]);

  const defaultVisible = useMemo(
    () => new Set(columns.filter((column) => column.required || column.defaultVisible !== false).map((column) => column.key)),
    [columns],
  );

  const visibleKeys = storedVisible ?? defaultVisible;
  const visibleColumns = columns.filter((column) => column.required || visibleKeys.has(column.key));

  function persist(next: Set<string>) {
    const normalized = new Set(next);
    for (const column of columns) if (column.required) normalized.add(column.key);
    setStoredVisible(normalized);
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
    if (!renderExpanded) return;
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
    <div className="w-full min-w-0">
      {toolbar && <div className="mb-2 flex flex-wrap items-center justify-end gap-2">{toolbar}</div>}

      {rows.length === 0 && empty ? (
        empty
      ) : (
        <>
          <div className="space-y-2 lg:hidden">
            {rows.map((row) => {
              const id = getRowId(row);
              const expandable = Boolean(renderExpanded && (canExpand ? canExpand(row) : true));
              const expanded = expandable && expandedId === id;
              const toggle = () => { if (expandable) setExpanded(expanded ? null : id); };
              return (
                <div key={id} className={cn("overflow-hidden rounded-card border bg-surface", expanded ? "border-primary-200 shadow-e1" : "border-border-soft")}>
                  {renderMobileRow ? (
                    renderMobileRow({ row, expanded, toggle })
                  ) : (
                    <button type="button" onClick={toggle} className="w-full p-3 text-left">
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
            className={cn("hidden rounded-card border border-border-soft bg-surface lg:block", maxHeight ? "overflow-auto" : "overflow-x-auto", fillHeight && "h-full")}
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
                  {visibleColumns.map((column) => (
                    <th
                      key={column.key}
                      className={cn(
                        "px-3 py-3",
                        maxHeight && "sticky top-0 z-10 bg-canvas",
                        column.align === "right" && "text-right",
                        column.align === "center" && "text-center",
                        column.headerClassName,
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
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
                {rows.map((row) => {
                  const id = getRowId(row);
                  const expandable = Boolean(renderExpanded && (canExpand ? canExpand(row) : true));
                  const expanded = expandable && expandedId === id;
                  return (
                    <Fragment key={id}>
                      <tr
                        className={cn(
                          "border-t border-border-soft transition-colors",
                          expandable && "cursor-pointer",
                          expanded ? "bg-primary-50/45 dark:bg-primary-950/15" : "hover:bg-surface-2",
                          rowClassName?.(row, expanded),
                        )}
                        onClick={() => { if (expandable) setExpanded(expanded ? null : id); }}
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
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={column.required}
                      onChange={() => onToggle(column.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-primary-600"
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
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl" | "full";
  closeLabel?: string;
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
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div id={titleId} className="truncate text-lg font-bold">{title}</div>
            {subtitle && <div className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-surface-2 hover:text-slate-700" aria-label={closeLabel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">{children}</div>
        {footer && <div className="border-t border-border-soft px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}
