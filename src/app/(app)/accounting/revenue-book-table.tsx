"use client";

import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileRecordField } from "@/components/mobile-ui";
import Link from "next/link";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { RevenueBookRow } from "@/lib/data/accounting";
import { Routes } from "@/lib/routes";

export function RevenueBookTable({ rows, showActivity }: { rows: RevenueBookRow[]; showActivity: boolean }) {
  const columns: DataTableColumn<RevenueBookRow>[] = [
    { key: "date", label: "Ngày tháng", required: true, width: "150px", render: (row) => formatDate(row.date) },
    {
      key: "transaction", label: "Giao dịch", required: true, render: (row) => (
        <div className="min-w-0">
          {row.sourceType === "sale" ? (
            <Link href={Routes.orderDetail(row.sourceId)} className="font-semibold text-primary-700 hover:underline">{row.code}</Link>
          ) : <div className="font-semibold text-er">{row.code}</div>}
          <div className="mt-0.5 text-xs text-slate-500">{row.description}</div>
        </div>
      ),
    },
    ...(showActivity ? [{
      key: "activity", label: "Nhóm ngành tính thuế", defaultVisible: true, width: "210px",
      render: (row: RevenueBookRow) => row.activityName
        ? <div><div>{row.activityName}</div><div className="text-xs text-slate-400">GTGT {row.vatRate}% · TNCN {row.pitRate}%</div></div>
        : <span className="text-warn">Chưa phân loại</span>,
    } satisfies DataTableColumn<RevenueBookRow>] : []),
    { key: "amount", label: "Số tiền", required: true, align: "right", width: "160px", cellClassName: (row) => cn("font-bold tabular-nums", row.amount < 0 && "text-er"), render: (row) => formatCurrency(row.amount) },
    { key: "salesChannel", label: "Kênh bán", defaultVisible: true, width: "150px", render: (row) => row.salesChannel },
    { key: "einvoiceNumber", label: "Số HĐĐT", defaultVisible: true, width: "130px", render: (row) => row.einvoiceNumber || "—" },
    { key: "einvoiceSerial", label: "Ký hiệu", defaultVisible: true, width: "120px", render: (row) => row.einvoiceSerial || "—" },
    { key: "createdByName", label: "Người tạo", defaultVisible: false, width: "160px", render: (row) => row.createdByName || "—" },
  ];
  return (
    <DataTableShell
      tableId="accounting.revenue-book"
      rows={rows}
      columns={columns}
      getRowId={(row) => `${row.sourceType}-${row.id}`}
      minWidth={showActivity ? "1180px" : "960px"}
      minHeight={420}
      empty={<div className="rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400">Không có giao dịch trong kỳ đã chọn.</div>}
      renderMobileRow={({ row }) => (
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-bold">{row.code}</div><div className="text-xs text-slate-500">{formatDate(row.date)}</div></div>
            <div className={cn("font-bold tabular-nums", row.amount < 0 && "text-er")}>{formatCurrency(row.amount)}</div>
          </div>
          <div className="mt-2 text-sm text-slate-600">{row.description}</div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <MobileRecordField label="HĐ điện tử" value={row.einvoiceNumber || "Chưa có"} />
            <MobileRecordField label="Kênh bán" value={row.salesChannel} />
            {showActivity && <MobileRecordField label="Nhóm ngành" value={row.activityName || "Chưa phân loại"} />}
          </dl>
        </div>
      )}
    />
  );
}
