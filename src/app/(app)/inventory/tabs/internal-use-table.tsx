"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarDays,
  ChevronDown,
  Copy,
  FileDown,
  HelpCircle,
  LayoutList,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { getInternalUseIssues } from "@/lib/data/internal-use";

type InternalUseRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];
type StatusFilter = "pending" | "approved";

const STATUS_FILTERS: StatusFilter[] = ["pending", "approved"];

export function InternalUseTable({ rows }: { rows: InternalUseRow[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const isVi = locale === "vi";
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(rows[0]?.id ?? null);
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set(STATUS_FILTERS));
  const [reasonFilter, setReasonFilter] = useState("");

  const reasonOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.reason).filter((reason): reason is string => Boolean(reason)))),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const status = normalizeStatus(row.status);
      if (!statusFilters.has(status)) return false;
      if (reasonFilter && row.reason !== reasonFilter) return false;
      if (!needle) return true;
      return [row.code, row.reason, row.department, row.note, row.createdByName, row.warehouseName]
        .some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [query, reasonFilter, rows, statusFilters]);

  function toggleStatus(status: StatusFilter) {
    setStatusFilters((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function toggleRow(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-card border border-border bg-surface p-4 shadow-e1 xl:sticky xl:top-30 xl:self-start">
        <h2 className="text-xl font-extrabold">{isVi ? "Xuất dùng nội bộ" : t("nav.internalUse")}</h2>

        <FilterBlock title={isVi ? "Trạng thái" : "Status"}>
          {STATUS_FILTERS.map((status) => (
            <label key={status} className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={statusFilters.has(status)}
                onChange={() => toggleStatus(status)}
                className="h-4 w-4 rounded border-border accent-primary-600"
              />
              {statusLabel(status, isVi)}
            </label>
          ))}
        </FilterBlock>

        <FilterBlock title={isVi ? "Thời gian" : "Date"}>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span className="h-3 w-3 rounded-full border-4 border-primary-600" />
            <span className="flex h-10 flex-1 items-center justify-between rounded-xl border border-border bg-canvas px-3">
              {isVi ? "Tháng này" : "This month"}
              <ChevronDown className="h-4 w-4 text-slate-400 -rotate-90" />
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span className="h-3 w-3 rounded-full border border-slate-400" />
            <span className="flex h-10 flex-1 items-center justify-between rounded-xl border border-border bg-canvas px-3">
              {isVi ? "Tùy chỉnh" : "Custom"}
              <CalendarDays className="h-4 w-4 text-slate-400" />
            </span>
          </label>
        </FilterBlock>

        <FilterBlock title={isVi ? "Loại xuất" : "Issue type"}>
          <select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-canvas px-3 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            <option value="">{isVi ? "Chọn loại xuất" : "All types"}</option>
            {reasonOptions.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </FilterBlock>
      </aside>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1 xl:max-w-xl">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={isVi ? "Theo mã xuất dùng nội bộ" : "Search internal-use code"}
              className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-10 text-sm shadow-e1 transition focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
            <SlidersHorizontal className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ToolbarButton tone="primary" onClick={openCreateForm}><Plus className="h-4 w-4" />{isVi ? "Xuất dùng nội bộ" : t("internalUse.formTitle")}</ToolbarButton>
            <ToolbarButton><FileDown className="h-4 w-4" />{isVi ? "Xuất file" : "Export"}</ToolbarButton>
            <IconButton label="list"><LayoutList className="h-4 w-4" /></IconButton>
            <IconButton label="settings"><Settings className="h-4 w-4" /></IconButton>
            <IconButton label="help"><HelpCircle className="h-4 w-4" /></IconButton>
          </div>
        </div>

        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-e2">
          {filteredRows.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-4 py-12 text-center">
              <LayoutList className="mb-3 h-9 w-9 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">{t("internalUse.empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] table-fixed text-sm">
                <colgroup>
                  <col className="w-11" />
                  <col className="w-11" />
                  <col className="w-38" />
                  <col className="w-36" />
                  <col className="w-36" />
                  <col className="w-42" />
                  <col className="w-54" />
                  <col />
                  <col className="w-34" />
                </colgroup>
                <thead>
                  <tr className="border-b border-primary-200 bg-primary-50/70 text-left text-xs font-bold text-slate-800 dark:bg-primary-950/25 dark:text-slate-200">
                    <th className="px-3 py-3"><input type="checkbox" className="h-4 w-4 rounded border-border accent-primary-600" /></th>
                    <th className="px-3 py-3"><Star className="h-4 w-4 text-slate-400" /></th>
                    <th className="px-3 py-3">{isVi ? "Mã xuất dùng nội bộ" : t("internalUse.cols.code")}</th>
                    <th className="px-3 py-3">{isVi ? "Loại xuất" : t("internalUse.reason")}</th>
                    <th className="px-3 py-3 text-right">{isVi ? "Tổng giá trị" : t("internalUse.cols.cost")}</th>
                    <th className="px-3 py-3">{isVi ? "Thời gian" : t("orders.cols.date")}</th>
                    <th className="px-3 py-3">{isVi ? "Chi nhánh" : "Branch"}</th>
                    <th className="px-3 py-3">{t("internalUse.note")}</th>
                    <th className="px-3 py-3">{isVi ? "Trạng thái" : t("orders.cols.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const expanded = expandedId === row.id;
                    return (
                      <IssueRows
                        key={row.id}
                        row={row}
                        expanded={expanded}
                        isVi={isVi}
                        onToggle={() => toggleRow(row.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function openCreateForm() {
  const details = document.getElementById("internal-use-create") as HTMLDetailsElement | null;
  if (!details) return;
  details.open = true;
  details.scrollIntoView({ block: "start", behavior: "smooth" });
}

function IssueRows({ row, expanded, isVi, onToggle }: { row: InternalUseRow; expanded: boolean; isVi: boolean; onToggle: () => void }) {
  const status = normalizeStatus(row.status);
  const totalQty = row.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-border-soft transition hover:bg-surface-2",
          expanded && "border-primary-400 bg-primary-50/20 shadow-[inset_3px_0_0_var(--primary-500)] dark:bg-primary-950/15",
        )}
      >
        <td className="px-3 py-3"><input type="checkbox" onClick={(event) => event.stopPropagation()} className="h-4 w-4 rounded border-border accent-primary-600" /></td>
        <td className="px-3 py-3"><Star className="h-4 w-4 text-slate-400" /></td>
        <td className="truncate px-3 py-3 font-mono font-bold">{row.code}</td>
        <td className="truncate px-3 py-3">{row.reason ?? "—"}</td>
        <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">{formatNumber(row.totalCost)}</td>
        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{formatDate(row.createdAt)}</td>
        <td className="truncate px-3 py-3">{row.warehouseName ?? "—"}</td>
        <td className="truncate px-3 py-3 text-slate-600 dark:text-slate-300">{row.note ?? "—"}</td>
        <td className="px-3 py-3"><StatusBadge status={status} isVi={isVi} /></td>
      </tr>

      {expanded && (
        <tr className="border-b border-primary-400">
          <td colSpan={9} className="p-0">
            <div className="bg-surface px-6 py-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-extrabold">{row.code}</h3>
                    <StatusBadge status={status} isVi={isVi} />
                  </div>
                  <div className="mt-4 grid gap-x-10 gap-y-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <Field label={isVi ? "Người tạo" : "Created by"} value={row.createdByName ?? "—"} />
                    <Field label={isVi ? "Người xuất" : "Issued by"} value={row.createdByName ?? "—"} />
                    <Field label={isVi ? "Ngày xuất" : "Issued at"} value={formatDate(row.createdAt)} />
                    <Field label={isVi ? "Loại xuất" : "Issue type"} value={row.reason ?? "—"} />
                    <Field label={isVi ? "Người nhận" : "Receiver"} value={row.department ?? "—"} />
                  </div>
                </div>
                <div className="text-right text-sm font-semibold text-slate-600 dark:text-slate-300">{row.warehouseName ?? "—"}</div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-38" />
                    <col />
                    <col className="w-28" />
                    <col className="w-28" />
                    <col className="w-36" />
                    <col className="w-36" />
                  </colgroup>
                  <thead>
                    <tr className="bg-surface-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200">
                      <th className="px-3 py-3">{isVi ? "Mã hàng" : "SKU"}</th>
                      <th className="px-3 py-3">{isVi ? "Tên hàng" : "Product"}</th>
                      <th className="px-3 py-3">{isVi ? "Đơn vị" : "Unit"}</th>
                      <th className="px-3 py-3 text-right">{isVi ? "SL xuất" : "Qty"}</th>
                      <th className="px-3 py-3 text-right">{isVi ? "Giá vốn" : "Unit cost"}</th>
                      <th className="px-3 py-3 text-right">{isVi ? "Giá trị xuất" : "Line total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.items.map((item) => (
                      <tr key={item.id} className="border-t border-border-soft">
                        <td className="px-3 py-3 font-mono font-semibold text-primary-600">{item.sku ?? "—"}</td>
                        <td className="truncate px-3 py-3 font-semibold">{item.productName}</td>
                        <td className="px-3 py-3">{item.unitName}</td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{formatNumber(item.quantity)}</td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{formatNumber(item.unitCost)}</td>
                        <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">{formatNumber(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-h-28 rounded-xl border border-border bg-canvas px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {row.note ?? (isVi ? "Không có ghi chú" : "No note")}
                </div>
                <div className="space-y-3 text-sm">
                  <SummaryLine label={isVi ? "Tổng số lượng" : "Total quantity"} value={formatNumber(totalQty)} />
                  <SummaryLine label={isVi ? "Tổng giá trị" : "Total value"} value={formatCurrency(row.totalCost)} strong />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <TextAction><Trash2 className="h-4 w-4" />{isVi ? "Hủy" : "Cancel"}</TextAction>
                  <TextAction><Copy className="h-4 w-4" />{isVi ? "Sao chép" : "Copy"}</TextAction>
                  <TextAction><FileDown className="h-4 w-4" />{isVi ? "Xuất file" : "Export"}</TextAction>
                </div>
                <div className="flex items-center gap-2">
                  <SmallAction><Save className="h-4 w-4" />{isVi ? "Lưu" : "Save"}</SmallAction>
                  <SmallAction><Printer className="h-4 w-4" />{isVi ? "In" : "Print"}</SmallAction>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 space-y-3">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </div>
  );
}

function ToolbarButton({ children, tone, onClick }: { children: ReactNode; tone?: "primary"; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition active:scale-[0.98]",
        tone === "primary"
          ? "border-primary-500 bg-surface text-primary-700 hover:bg-primary-50"
          : "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-slate-600 transition hover:bg-surface-2 active:scale-[0.98] dark:text-slate-200">
      {children}
    </button>
  );
}

function TextAction({ children }: { children: ReactNode }) {
  return <button type="button" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 transition hover:text-primary-700 dark:text-slate-300">{children}</button>;
}

function SmallAction({ children }: { children: ReactNode }) {
  return <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-slate-600 transition hover:bg-surface-2 dark:text-slate-200">{children}</button>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] items-center gap-2">
      <span className="text-slate-500">{label}:</span>
      <span className="truncate font-semibold">{value}</span>
    </div>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <span className="text-slate-500">{label}</span>
      <span className={cn("font-mono tabular-nums", strong && "text-base font-extrabold text-foreground")}>{value}</span>
    </div>
  );
}

function StatusBadge({ status, isVi }: { status: StatusFilter; isVi: boolean }) {
  return (
    <span className={cn("inline-flex rounded-lg px-2.5 py-1 text-xs font-extrabold", status === "approved" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
      {statusLabel(status, isVi)}
    </span>
  );
}

function normalizeStatus(status: string): StatusFilter {
  return status === "pending" ? "pending" : "approved";
}

function statusLabel(status: StatusFilter, isVi: boolean) {
  if (!isVi) return status === "pending" ? "Draft" : "Completed";
  return status === "pending" ? "Phiếu tạm" : "Hoàn thành";
}
