"use client";

import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { getAccountingAuxiliaryBooks, getTaxActivityRevenue } from "@/lib/data/accounting";
import type { RevenueBookRow } from "@/lib/data/accounting";

type Books = Awaited<ReturnType<typeof getAccountingAuxiliaryBooks>>;
type ActivityRows = Awaited<ReturnType<typeof getTaxActivityRevenue>>;

export function TaxActivityRevenueBook({ rows }: { rows: ActivityRows }) {
  const columns: DataTableColumn<ActivityRows[number]>[] = [
    { key: "activityName", label: "Nhóm ngành tính thuế", required: true, render: (row) => <span className={row.activityId ? "font-bold" : "font-bold text-warn"}>{row.activityName}</span> },
    { key: "vatRate", label: "% GTGT", required: true, align: "right", width: "120px", render: (row) => `${row.vatRate}%` },
    { key: "pitRate", label: "% TNCN", required: true, align: "right", width: "120px", render: (row) => `${row.pitRate}%` },
    { key: "revenue", label: "Doanh thu", required: true, align: "right", width: "170px", render: (row) => formatCurrency(row.revenue) },
    { key: "vatAmount", label: "Thuế GTGT dự kiến", defaultVisible: true, align: "right", width: "180px", render: (row) => formatCurrency(Math.round(row.revenue * row.vatRate / 100)) },
    { key: "pitAmount", label: "Thuế TNCN dự kiến", defaultVisible: true, align: "right", width: "180px", render: (row) => formatCurrency(Math.round(row.revenue * row.pitRate / 100)) },
  ];
  return <DataTableShell tableId="accounting.tax-activity-revenue" rows={rows} columns={columns} getRowId={(row) => `${row.activityId ?? "unclassified"}-${row.vatRate}-${row.pitRate}`} minWidth="900px" empty={<Empty />} />;
}

export function IncomeExpenseBook({ revenue, purchases, expenses }: Pick<Books, "purchases" | "expenses"> & { revenue: RevenueBookRow[] }) {
  const rows = [
    ...revenue.map((row) => ({ id: row.id, date: row.date, code: row.code, description: row.description, revenue: row.amount, expense: 0, kind: row.sourceType === "sale" ? "Doanh thu" : "Giảm doanh thu" })),
    ...purchases.map((row) => ({ ...row, revenue: 0, expense: row.amount, kind: "Mua hàng" })),
    ...expenses.map((row) => ({ ...row, revenue: 0, expense: row.amount, kind: "Chi phí" })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: "date", label: "Ngày", required: true, width: "150px", render: (row) => formatDate(row.date) },
    { key: "code", label: "Chứng từ", required: true, width: "150px", render: (row) => <span className="font-bold">{row.code}</span> },
    { key: "kind", label: "Phân loại", defaultVisible: true, width: "130px", render: (row) => row.kind },
    { key: "description", label: "Diễn giải", required: true, render: (row) => row.description || "—" },
    { key: "revenue", label: "Doanh thu", required: true, align: "right", width: "170px", render: (row) => row.revenue ? formatCurrency(row.revenue) : "—" },
    { key: "expense", label: "Chi phí", required: true, align: "right", width: "170px", render: (row) => row.expense ? formatCurrency(row.expense) : "—" },
  ];
  return <DataTableShell tableId="accounting.income-expense" rows={rows} columns={columns} getRowId={(row) => `${row.kind}-${row.id}`} minWidth="820px" empty={<Empty />} />;
}

export function InventoryDetailBook({ rows }: { rows: Books["inventory"] }) {
  const columns: DataTableColumn<Books["inventory"][number]>[] = [
    { key: "date", label: "Ngày", required: true, width: "150px", render: (row) => formatDate(row.date) },
    { key: "product", label: "Hàng hóa", required: true, render: (row) => <div><div className="font-bold">{row.productName}</div><div className="text-xs text-slate-400">{row.sku}</div></div> },
    { key: "warehouse", label: "Kho", defaultVisible: true, width: "160px", render: (row) => row.warehouseName },
    { key: "type", label: "Nghiệp vụ", defaultVisible: true, width: "150px", render: (row) => row.type },
    { key: "quantity", label: "Số lượng", required: true, align: "right", width: "130px", render: (row) => `${row.quantity.toLocaleString("vi-VN")} ${row.unit}` },
    { key: "unitCost", label: "Đơn giá vốn", defaultVisible: true, align: "right", width: "160px", render: (row) => row.unitCost == null ? "—" : formatCurrency(row.unitCost) },
  ];
  return <DataTableShell tableId="accounting.inventory" rows={rows} columns={columns} getRowId={(row) => row.id} minWidth="900px" empty={<Empty />} />;
}

export function CashDetailBook({ rows }: { rows: Books["cash"] }) {
  const columns: DataTableColumn<Books["cash"][number]>[] = [
    { key: "date", label: "Ngày", required: true, width: "150px", render: (row) => formatDate(row.date) },
    { key: "code", label: "Chứng từ", required: true, width: "150px", render: (row) => <span className="font-bold">{row.code}</span> },
    { key: "description", label: "Diễn giải", required: true, render: (row) => row.description || row.category },
    { key: "fund", label: "Quỹ", defaultVisible: true, width: "120px", render: (row) => row.fund === "cash" ? "Tiền mặt" : "Ngân hàng" },
    { key: "in", label: "Thu", defaultVisible: true, align: "right", width: "150px", render: (row) => row.type === "in" ? formatCurrency(row.amount) : "—" },
    { key: "out", label: "Chi", defaultVisible: true, align: "right", width: "150px", render: (row) => row.type === "out" ? formatCurrency(row.amount) : "—" },
  ];
  return <DataTableShell tableId="accounting.cash" rows={rows} columns={columns} getRowId={(row) => row.id} minWidth="860px" empty={<Empty />} />;
}

export function OtherTaxBook({ rows }: { rows: Books["taxes"] }) {
  const columns: DataTableColumn<Books["taxes"][number]>[] = [
    { key: "occurredOn", label: "Ngày ghi nhận", required: true, width: "150px", render: (row) => row.occurredOn },
    { key: "taxType", label: "Loại thuế", required: true, width: "190px", render: (row) => row.taxType },
    { key: "description", label: "Diễn giải", required: true, render: (row) => row.description },
    { key: "reference", label: "Chứng từ", defaultVisible: true, width: "140px", render: (row) => row.reference || "—" },
    { key: "payableAmount", label: "Phải nộp", required: true, align: "right", width: "150px", render: (row) => formatCurrency(row.payableAmount) },
    { key: "paidAmount", label: "Đã nộp", required: true, align: "right", width: "150px", render: (row) => formatCurrency(row.paidAmount) },
  ];
  return <DataTableShell tableId="accounting.other-tax" rows={rows} columns={columns} getRowId={(row) => row.id} minWidth="900px" empty={<Empty />} />;
}

function Empty() { return <div className="rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400">Chưa có dữ liệu trong kỳ.</div>; }
