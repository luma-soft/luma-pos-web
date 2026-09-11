import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { BatchDebtSummary as Summary } from "@/lib/print/batch-debt-summary";
import type { PaperSize, PrintTemplate } from "@/lib/print/template-shared";

interface Labels {
  title: string;
  customer: string;
  printedAt: string;
  invoice: string;
  invoiceDate: string;
  invoiceTotal: string;
  paid: string;
  remaining: string;
  openingDebt: string;
  openingCredit: string;
  batchTotal: string;
  batchPaid: string;
  batchRemaining: string;
  currentDebt: string;
}

interface Props {
  template: PrintTemplate;
  size: PaperSize;
  summary: Summary;
  printedAt: Date | string;
  labels: Labels;
}

export function BatchDebtSummary({ template, size, summary, printedAt, labels }: Props) {
  if (size === "k80") {
    return (
      <div className="print-document w-[302px] bg-white px-3 py-4 font-mono text-[10px] leading-[1.4] text-black shadow-lg print:shadow-none">
        <header className="text-center">
          <div className="text-[14px] font-black uppercase">{template.storeName || "—"}</div>
          <div className="mt-2 border-y-2 border-black py-1.5 text-[12px] font-black uppercase">{labels.title}</div>
        </header>
        <div className="my-2">
          <div><span className="text-slate-600">{labels.customer}:</span> <b>{summary.customerName}</b></div>
          <div><span className="text-slate-600">{labels.printedAt}:</span> {formatDate(printedAt)}</div>
        </div>
        <table className="w-full table-fixed border-collapse text-[8.5px] leading-tight">
          <colgroup><col className="w-[34%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[22%]" /></colgroup>
          <thead><tr className="border-y border-black">
            <th className="py-1 text-left">{labels.invoice}</th>
            <th className="py-1 text-right">{labels.invoiceTotal}</th>
            <th className="py-1 text-right">{labels.paid}</th>
            <th className="py-1 text-right">{labels.remaining}</th>
          </tr></thead>
          <tbody>{summary.invoices.map((invoice) => (
            <tr key={invoice.id} className="border-b border-dashed border-slate-400 align-top">
              <td className="py-1 pr-1"><b>{invoice.code}</b><div className="text-[7.5px] text-slate-600">{formatDate(invoice.createdAt)}</div></td>
              <td className="py-1 text-right tabular-nums">{formatNumber(invoice.total)}</td>
              <td className="py-1 text-right tabular-nums">{formatNumber(invoice.paid)}</td>
              <td className="py-1 text-right font-bold tabular-nums">{formatNumber(invoice.remaining)}</td>
            </tr>
          ))}</tbody>
        </table>
        <DebtTotals summary={summary} labels={labels} compact />
      </div>
    );
  }

  const isA4 = size === "a4";
  return (
    <div className={isA4
      ? "print-document print-document--a4 bg-white text-black w-[794px] min-h-[1000px] p-12 text-[13px] shadow-lg print:shadow-none"
      : "print-document print-document--a5 bg-white text-black w-[559px] min-h-[794px] p-10 text-[13px] shadow-lg print:shadow-none"
    }>
      <header className="flex justify-between border-b-2 border-black pb-3">
        <div>
          <div className={isA4 ? "text-[18px] font-bold" : "text-[16px] font-bold"}>{template.storeName || "—"}</div>
          <div className="text-[11px] text-slate-600">{template.storeAddress}{template.storePhone && <><br />ĐT: {template.storePhone}</>}</div>
        </div>
        <div className="text-right">
          <div className={isA4 ? "text-[17px] font-bold" : "text-[15px] font-bold"}>{labels.title}</div>
          <div className="text-[11px] text-slate-600">{labels.printedAt}: {formatDate(printedAt)}</div>
        </div>
      </header>
      <div className="my-4"><b>{labels.customer}:</b> {summary.customerName}</div>
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-slate-100">
          <th className="border border-slate-400 px-2 py-1.5 text-left">{labels.invoice}</th>
          <th className="border border-slate-400 px-2 py-1.5">{labels.invoiceDate}</th>
          <th className="border border-slate-400 px-2 py-1.5 text-right">{labels.invoiceTotal}</th>
          <th className="border border-slate-400 px-2 py-1.5 text-right">{labels.paid}</th>
          <th className="border border-slate-400 px-2 py-1.5 text-right">{labels.remaining}</th>
        </tr></thead>
        <tbody>{summary.invoices.map((invoice) => (
          <tr key={invoice.id} className="break-inside-avoid">
            <td className="border border-slate-400 px-2 py-1.5 font-bold">{invoice.code}</td>
            <td className="border border-slate-400 px-2 py-1.5 text-center">{formatDate(invoice.createdAt)}</td>
            <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(invoice.total)}</td>
            <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(invoice.paid)}</td>
            <td className="border border-slate-400 px-2 py-1.5 text-right font-bold">{formatNumber(invoice.remaining)}</td>
          </tr>
        ))}</tbody>
      </table>
      <DebtTotals summary={summary} labels={labels} />
    </div>
  );
}

function DebtTotals({ summary, labels, compact = false }: { summary: Summary; labels: Labels; compact?: boolean }) {
  const openingBalance = summary.openingDebt < 0
    ? [labels.openingCredit, Math.abs(summary.openingDebt)] as const
    : [labels.openingDebt, summary.openingDebt] as const;
  const rows = [
    openingBalance,
    [labels.batchTotal, summary.batchTotal],
    [labels.batchPaid, summary.batchPaid],
    [labels.batchRemaining, summary.batchRemaining],
  ] as const;
  return (
    <div className={compact ? "mt-2 border-y-2 border-black py-1.5" : "mt-4 ml-auto w-[390px] max-w-full break-inside-avoid"}>
      {rows.map(([label, value], index) => (
        <div key={label} className={`flex justify-between gap-3 py-0.5 ${index === 0 ? "mb-1 border-b border-slate-300 pb-1" : ""}`}>
          <span className="text-slate-600">{label}</span>
          <span className="shrink-0 tabular-nums">{formatNumber(value)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-black pt-1.5 font-black">
        <span>{labels.currentDebt}</span><span className={compact ? "text-[12px]" : "text-[14px]"}>{formatCurrency(summary.currentDebt)}</span>
      </div>
    </div>
  );
}
