"use client";

import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReportExportButton({
  rows,
  className,
  iconOnly = false,
}: {
  rows: (string | number | null)[][];
  className?: string;
  iconOnly?: boolean;
}) {
  function download() {
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `bao-cao-lumapos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      aria-label="Xuất báo cáo"
      className={cn(
        className,
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-bold text-slate-700 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
      )}
    >
      <Download className="h-4 w-4" />
      {!iconOnly && <span>Xuất báo cáo</span>}
    </button>
  );
}

function csvCell(value: string | number | null) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
