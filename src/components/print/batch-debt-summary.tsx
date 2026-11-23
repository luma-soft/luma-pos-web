import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { BatchDebtSummary as Summary } from "@/lib/print/batch-debt-summary";
import type { PrintPaymentQr } from "@/lib/print/payment-qr";
import { moneyToWords, type PaperSize, type PrintTemplate } from "@/lib/print/template-shared";

export interface BatchDebtSummaryLabels {
  title: string;
  customer: string;
  phone: string;
  period: string;
  printedAt: string;
  index: string;
  invoicesSection: string;
  invoice: string;
  invoiceDate: string;
  invoiceTotal: string;
  paid: string;
  remaining: string;
  total: string;
  movementsSection: string;
  movementCode: string;
  movementType: string;
  movementAmount: string;
  reconciliationSection: string;
  openingDebt: string;
  openingCredit: string;
  increases: string;
  decreases: string;
  currentDebt: string;
  currentCredit: string;
  inWords: string;
  customerSign: string;
  sellerSign: string;
  signHint: string;
}

interface Props {
  template: PrintTemplate;
  size: PaperSize;
  summary: Summary;
  printedAt: Date | string;
  labels: BatchDebtSummaryLabels;
  paymentQr?: PrintPaymentQr | null;
}

const dateOnly = (value: Date | string) => formatDate(value).split(" ").pop() ?? "";

export function BatchDebtSummary({ template, size, summary, printedAt, labels, paymentQr }: Props) {
  const period = `${dateOnly(summary.periodStart)} – ${dateOnly(printedAt)}`;

  if (size === "k80") {
    return (
      <div className="print-document w-[302px] bg-white px-3 py-4 font-mono text-[10px] leading-[1.4] text-black shadow-lg print:shadow-none">
        <header className="text-center">
          <div className="text-[14px] font-black uppercase">{template.storeName || "—"}</div>
          {template.storePhone && <div className="text-[9px]">ĐT: {template.storePhone}</div>}
          <div className="mt-2 border-y-2 border-black py-1.5 text-[12px] font-black uppercase">{labels.title}</div>
        </header>
        <div className="my-2">
          <div><span className="text-slate-600">{labels.customer}:</span> <b>{summary.customerName}</b></div>
          {summary.customerPhone && <div><span className="text-slate-600">{labels.phone}:</span> {summary.customerPhone}</div>}
          <div><span className="text-slate-600">{labels.period}:</span> {period}</div>
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
              <td className="py-1 pr-1"><b>{invoice.code}</b><div className="text-[7.5px] text-slate-600">{dateOnly(invoice.createdAt)}</div></td>
              <td className="py-1 text-right tabular-nums">{formatNumber(invoice.total)}</td>
              <td className="py-1 text-right tabular-nums">{formatNumber(invoice.paid)}</td>
              <td className="py-1 text-right font-bold tabular-nums">{formatNumber(invoice.remaining)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="border-b border-black font-bold">
            <td className="py-1">{labels.total}</td>
            <td className="py-1 text-right tabular-nums">{formatNumber(summary.invoiceTotal)}</td>
            <td className="py-1 text-right tabular-nums">{formatNumber(summary.invoicePaid)}</td>
            <td className="py-1 text-right tabular-nums">{formatNumber(summary.invoiceRemaining)}</td>
          </tr></tfoot>
        </table>
        {summary.movements.length > 0 && (
          <div className="mt-2">
            <div className="font-bold">{labels.movementsSection}</div>
            {summary.movements.map((movement) => (
              <div key={movement.id} className="flex justify-between gap-2 border-b border-dashed border-slate-400 py-0.5 text-[8.5px]">
                <span className="min-w-0">{dateOnly(movement.createdAt)} · {movement.typeLabel}<span className="block text-[7.5px] text-slate-600">{movement.code}</span></span>
                <span className="shrink-0 tabular-nums">{signed(movement.value)}</span>
              </div>
            ))}
          </div>
        )}
        <Reconciliation summary={summary} labels={labels} compact />
        {paymentQr && <PaymentQrBox qr={paymentQr} compact />}
      </div>
    );
  }

  const isA4 = size === "a4";
  const cell = "border border-slate-400 px-2 py-1.5";
  return (
    <div className={isA4
      ? "print-document print-document--a4 bg-white text-black w-[794px] min-h-[1000px] p-12 text-[13px] shadow-lg print:shadow-none"
      : "print-document print-document--a5 bg-white text-black w-[559px] min-h-[794px] p-10 text-[12px] shadow-lg print:shadow-none"
    }>
      <header className="flex justify-between gap-4 border-b-2 border-black pb-3">
        <div className="min-w-0">
          <div className={isA4 ? "text-[18px] font-bold" : "text-[16px] font-bold"}>{template.storeName || "—"}</div>
          <div className="text-[11px] text-slate-600">{template.storeAddress}{template.storePhone && <><br />ĐT: {template.storePhone}</>}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={isA4 ? "text-[17px] font-bold" : "text-[15px] font-bold"}>{labels.title}</div>
          <div className="text-[11px] text-slate-600">{labels.period}: {period}</div>
          <div className="text-[11px] text-slate-600">{labels.printedAt}: {formatDate(printedAt)}</div>
        </div>
      </header>

      <div className="my-4 flex flex-wrap gap-x-8 gap-y-1">
        <div><b>{labels.customer}:</b> {summary.customerName}</div>
        {summary.customerPhone && <div><b>{labels.phone}:</b> {summary.customerPhone}</div>}
      </div>

      <SectionTitle>{labels.invoicesSection}</SectionTitle>
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-slate-100">
          <th className={cn(cell, "w-10 text-center")}>{labels.index}</th>
          <th className={cn(cell, "text-left")}>{labels.invoice}</th>
          <th className={cell}>{labels.invoiceDate}</th>
          <th className={cn(cell, "text-right")}>{labels.invoiceTotal}</th>
          <th className={cn(cell, "text-right")}>{labels.paid}</th>
          <th className={cn(cell, "text-right")}>{labels.remaining}</th>
        </tr></thead>
        <tbody>{summary.invoices.map((invoice, index) => (
          <tr key={invoice.id} className="break-inside-avoid">
            <td className={cn(cell, "text-center")}>{index + 1}</td>
            <td className={cn(cell, "font-bold")}>{invoice.code}</td>
            <td className={cn(cell, "text-center")}>{dateOnly(invoice.createdAt)}</td>
            <td className={cn(cell, "text-right tabular-nums")}>{formatNumber(invoice.total)}</td>
            <td className={cn(cell, "text-right tabular-nums")}>{formatNumber(invoice.paid)}</td>
            <td className={cn(cell, "text-right font-bold tabular-nums")}>{formatNumber(invoice.remaining)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="bg-slate-50 font-bold">
          <td className={cell} colSpan={3}>{labels.total}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatNumber(summary.invoiceTotal)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatNumber(summary.invoicePaid)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatNumber(summary.invoiceRemaining)}</td>
        </tr></tfoot>
      </table>

      {summary.movements.length > 0 && (
        <>
          <SectionTitle>{labels.movementsSection}</SectionTitle>
          <table className="w-full border-collapse text-[12px]">
            <thead><tr className="bg-slate-100">
              <th className={cn(cell, "w-24")}>{labels.invoiceDate}</th>
              <th className={cn(cell, "text-left")}>{labels.movementCode}</th>
              <th className={cn(cell, "text-left")}>{labels.movementType}</th>
              <th className={cn(cell, "text-right")}>{labels.movementAmount}</th>
            </tr></thead>
            <tbody>{summary.movements.map((movement) => (
              <tr key={movement.id} className="break-inside-avoid">
                <td className={cn(cell, "text-center")}>{dateOnly(movement.createdAt)}</td>
                <td className={cell}>{movement.code}</td>
                <td className={cell}>{movement.typeLabel}</td>
                <td className={cn(cell, "text-right tabular-nums")}>{signed(movement.value)}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}

      <div className="mt-4 flex items-start justify-between gap-4 break-inside-avoid">
        <div className="min-w-0 flex-1">{paymentQr && <PaymentQrBox qr={paymentQr} />}</div>
        <div className="w-[390px] max-w-full shrink-0">
          <SectionTitle className="mt-0">{labels.reconciliationSection}</SectionTitle>
          <Reconciliation summary={summary} labels={labels} />
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 text-center break-inside-avoid">
        {[labels.customerSign, labels.sellerSign].map((label) => (
          <div key={label}>
            <div className="font-bold">{label}</div>
            <div className="text-[11px] italic text-slate-500">{labels.signHint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-1.5 mt-4 font-bold uppercase", className)}>{children}</div>;
}

function Reconciliation({ summary, labels, compact = false }: { summary: Summary; labels: BatchDebtSummaryLabels; compact?: boolean }) {
  const opening = summary.openingDebt < 0
    ? [labels.openingCredit, Math.abs(summary.openingDebt)] as const
    : [labels.openingDebt, summary.openingDebt] as const;
  const closingLabel = summary.currentDebt < 0 ? labels.currentCredit : labels.currentDebt;
  const rows = [
    [`${opening[0]} (${dateOnly(summary.periodStart)})`, formatNumber(opening[1])],
    [labels.increases, `+${formatNumber(summary.increases)}`],
    [labels.decreases, `−${formatNumber(summary.decreases)}`],
  ] as const;
  return (
    <div className={compact ? "mt-2 border-y-2 border-black py-1.5" : "rounded border border-slate-400 px-3 py-2"}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-0.5">
          <span className="text-slate-600">{label}</span>
          <span className="shrink-0 tabular-nums">{value}</span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-black pt-1.5 font-black">
        <span>{closingLabel}</span>
        <span className={compact ? "text-[12px]" : "text-[15px]"}>{formatCurrency(Math.abs(summary.currentDebt))}</span>
      </div>
      {summary.currentDebt > 0 && (
        <div className={cn("mt-1 italic text-slate-600", compact ? "text-[8.5px]" : "text-[11px]")}>
          {labels.inWords}: {moneyToWords(summary.currentDebt)}.
        </div>
      )}
    </div>
  );
}

function PaymentQrBox({ qr, compact = false }: { qr: PrintPaymentQr; compact?: boolean }) {
  const size = compact ? 96 : 112;
  return (
    <div className={cn("flex gap-3 rounded border border-slate-300 p-2 break-inside-avoid", compact ? "mt-2 text-[9px]" : "text-[11px]")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr.qrImageUrl} alt={qr.title} width={size} height={size} className="shrink-0 object-contain" />
      <div className="min-w-0">
        <div className="font-bold">{qr.title}</div>
        <div>{qr.bankLabel}: <b>{qr.bankName}</b></div>
        <div>{qr.accountLabel}: <b className="font-mono">{qr.accountNumber}</b></div>
        <div>{qr.nameLabel}: <b>{qr.accountName}</b></div>
        <div>{qr.referenceLabel}: <b className="font-mono">{qr.reference}</b></div>
      </div>
    </div>
  );
}

function signed(value: number) {
  return value < 0 ? `−${formatNumber(Math.abs(value))}` : `+${formatNumber(value)}`;
}
