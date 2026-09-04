import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { moneyToWords, type PaperSize, type PrintTemplate } from "@/lib/print/template-shared";

export interface PrintLine {
  id: string;
  name: string;
  sku?: string | null;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  lineDiscountMode?: "pct" | "vnd";
  lineDiscountValue?: number;
  total: number;
}

export interface PrintTotalRow {
  label: string;
  value: number;
  kind?: "subtotal" | "discount" | "tax" | "shipping" | "other";
  bold?: boolean;
  negative?: boolean;
}

export interface PrintDocProps {
  template: PrintTemplate;
  size: PaperSize;
  title: string;
  code: string;
  date: Date | string;
  partyLabel: string;       // "Khách hàng" / "Nhà cung cấp"
  partyName: string;
  partyPhone?: string | null;
  projectName?: string | null;
  deliveryAddress?: string | null;
  deliverToLabel?: string;
  sellerLabel?: string;
  sellerName?: string | null;
  items: PrintLine[];
  totals: PrintTotalRow[];   // các dòng dưới bảng (tạm tính, giảm, ship…)
  grandTotalLabel: string;
  grandTotal: number;
  afterTotals?: PrintTotalRow[]; // đã trả / còn lại…
  paymentQr?: {
    title: string;
    qrImageUrl: string;
    bankLabel: string;
    accountLabel: string;
    nameLabel: string;
    referenceLabel: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reference: string;
  } | null;
  inWordsLabel: string;
  signatures?: [string, string, string]; // [trái, giữa, phải]
  signHint?: string;
  note?: string | null;
  /** nhãn cột */
  cols: { product: string; unit: string; qty: string; unitPrice: string; discount?: string; lineTotal: string };
}

export function PrintDoc(p: PrintDocProps) {
  const t = p.template;
  if (p.size === "k80") return <K80Doc {...p} />;

  const isA4 = p.size === "a4";
  const signatures = p.signatures && (isA4 ? p.signatures : [p.signatures[0], p.signatures[2]]);
  const showLineDiscount = t.options.showLineDiscount && p.items.some((item) => Number(item.discount ?? 0) > 0);
  const visibleTotals = p.totals.filter((row) => {
    if (row.kind === "discount") return t.options.showDiscount;
    if (row.kind === "tax") return t.options.showTax;
    return true;
  });
  return (
    <div
      className={
        isA4
          ? "print-document print-document--a4 bg-white text-black w-[794px] min-h-[1000px] p-12 text-[13px] shadow-lg print:shadow-none"
          : "print-document print-document--a5 bg-white text-black w-[559px] min-h-[794px] p-10 text-[13px] shadow-lg print:shadow-none"
      }
    >
      {/* header */}
      <div className="flex justify-between border-b-2 border-black pb-3">
        <div>
          <div className={isA4 ? "font-bold text-[18px]" : "font-bold text-[16px]"}>{t.storeName || "—"}</div>
          <div className="text-[12px] text-slate-600">
            {t.storeAddress}
            {t.storePhone && <><br />ĐT: {t.storePhone}</>}
            {t.storeTaxCode && <> · MST: {t.storeTaxCode}</>}
          </div>
        </div>
        <div className="text-right">
          <div className={isA4 ? "font-bold text-[17px]" : "font-bold text-[15px]"}>{p.title}</div>
          <div className="text-[12px] text-slate-600">
            Số: <b>{p.code}</b><br />
            Ngày: {formatDate(p.date)}
          </div>
        </div>
      </div>

      {/* party */}
      <div className="my-3 flex justify-between text-[12.5px]">
        <div>
          <b>{p.partyLabel}:</b> {p.partyName}
          {p.partyPhone && <> — {p.partyPhone}</>}
          {t.options.showProject && p.projectName && <><br /><b>Công trình:</b> {p.projectName}</>}
          {p.deliveryAddress && <><br /><b>{p.deliverToLabel ?? "Giao đến"}:</b> {p.deliveryAddress}</>}
        </div>
        {t.options.showSeller && p.sellerName && (
          <div className="text-right"><b>{p.sellerLabel ?? "Người lập"}:</b> {p.sellerName}</div>
        )}
      </div>

      {/* items */}
      <table className="print-line-items w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-400 px-2 py-1.5 text-left">{p.cols.product}</th>
            <th className="border border-slate-400 px-2 py-1.5">{p.cols.unit}</th>
            <th className="border border-slate-400 px-2 py-1.5">{p.cols.qty}</th>
            <th className="border border-slate-400 px-2 py-1.5 text-right">{p.cols.unitPrice}</th>
            {showLineDiscount && <th className="border border-slate-400 px-2 py-1.5 text-right">{p.cols.discount ?? "Giảm giá"}</th>}
            <th className="border border-slate-400 px-2 py-1.5 text-right">{p.cols.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
          <tr key={i.id} className="break-inside-avoid">
              <td className="border border-slate-400 px-2 py-1.5">
                {i.name}
                {t.options.showSku && i.sku && <span className="text-slate-500 text-[10px]"> ({i.sku})</span>}
              </td>
              <td className="border border-slate-400 px-2 py-1.5 text-center">{i.unitName}</td>
              <td className="border border-slate-400 px-2 py-1.5 text-center">{formatNumber(i.quantity)}</td>
              <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(showLineDiscount || i.quantity <= 0 ? i.unitPrice : i.total / i.quantity)}</td>
              {showLineDiscount && <td className="border border-slate-400 px-2 py-1.5 text-right">{Number(i.discount ?? 0) > 0 ? <>{i.lineDiscountMode === "pct" && <div>{formatNumber(i.lineDiscountValue ?? 0)}%</div>}{formatNumber(Number(i.discount))}</> : "—"}</td>}
              <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="mt-3 flex justify-end text-[12.5px] break-inside-avoid">
        <table className={isA4 ? "w-[300px]" : "w-[260px]"}>
          <tbody>
            {visibleTotals.map((r) => (
              <tr key={r.label}>
                <td className="py-0.5 text-slate-600">{r.label}</td>
                <td className="text-right">{r.negative ? "− " : ""}{formatNumber(r.value)}</td>
              </tr>
            ))}
            <tr className="text-[14px]">
              <td className="py-1 font-bold">{p.grandTotalLabel}</td>
              <td className="text-right font-bold">{formatCurrency(p.grandTotal)}</td>
            </tr>
            {(p.afterTotals ?? []).map((r) => (
              <tr key={r.label} className={r.bold ? "font-bold" : ""}>
                <td className="py-0.5 text-slate-600">{r.label}</td>
                <td className="text-right">{formatNumber(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.options.showInWords && (
        <div className="mt-2 text-[12px] italic text-slate-600 break-inside-avoid">
          {p.inWordsLabel}: {moneyToWords(p.grandTotal)}.
        </div>
      )}

      {t.options.showPaymentQr && p.paymentQr && (
        <div className="mt-3 flex gap-3 rounded border border-slate-300 p-2 text-[12px] break-inside-avoid">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.paymentQr.qrImageUrl} alt={p.paymentQr.title} className={isA4 ? "h-24 w-24 object-contain" : "h-20 w-20 object-contain"} />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{p.paymentQr.title}</div>
            <div>{p.paymentQr.bankLabel}: <b>{p.paymentQr.bankName}</b></div>
            <div>{p.paymentQr.accountLabel}: <b className="font-mono">{p.paymentQr.accountNumber}</b></div>
            <div>{p.paymentQr.nameLabel}: <b>{p.paymentQr.accountName}</b></div>
            <div>{p.paymentQr.referenceLabel}: <b className="font-mono">{p.paymentQr.reference}</b></div>
          </div>
        </div>
      )}

      {p.note && <div className="mt-2 text-[12px] break-inside-avoid"><b>Ghi chú:</b> {p.note}</div>}

      {t.options.showSignatures && signatures && (
        <div className={`flex justify-between text-center text-[12px] break-inside-avoid ${isA4 ? "mt-14" : "mt-8"}`}>
          {signatures.map((s) => (
            <div key={s}><b>{s}</b><br /><i className="text-[10px] text-slate-500">{p.signHint ?? "(ký, họ tên)"}</i></div>
          ))}
        </div>
      )}

      {t.footerNote && (
        <div className={`mt-6 border-t border-dashed border-slate-400 pt-2 text-center text-[10.5px] text-slate-500 break-inside-avoid ${isA4 ? "" : "mt-5"}`}>
          {t.footerNote}
        </div>
      )}
    </div>
  );
}

function K80Doc(p: PrintDocProps) {
  const t = p.template;
  const visibleTotals = p.totals.filter((row) => {
    if (row.kind === "discount") return t.options.showDiscount;
    if (row.kind === "tax") return t.options.showTax;
    return true;
  });
  return (
    <div className="print-document w-[302px] bg-white px-3 py-4 font-mono text-[11px] leading-[1.45] text-black shadow-lg print:shadow-none">
      <header className="text-center">
        <div className="text-[15px] font-black uppercase tracking-tight">{t.storeName || "—"}</div>
        {t.storeAddress && <div className="mt-1 text-[10px] leading-snug">{t.storeAddress}</div>}
        {t.storePhone && <div className="text-[10px]">ĐT: {t.storePhone}</div>}
        {t.storeTaxCode && <div className="text-[10px]">MST: {t.storeTaxCode}</div>}
      </header>

      <div className="my-3 border-y-2 border-black py-1.5 text-center">
        <div className="text-[12px] font-black uppercase tracking-wide">{p.title}</div>
        <div className="mt-0.5 text-[10px] font-bold">{p.code}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <div><span className="text-slate-600">Ngày:</span> {formatDate(p.date)}</div>
        {t.options.showSeller && p.sellerName && <div className="truncate text-right"><span className="text-slate-600">NV:</span> {p.sellerName}</div>}
        <div className="col-span-2 truncate"><span className="text-slate-600">{p.partyLabel}:</span> <span className="font-bold">{p.partyName}</span>{p.partyPhone ? ` · ${p.partyPhone}` : ""}</div>
        {t.options.showProject && p.projectName && <div className="col-span-2 truncate"><span className="text-slate-600">Công trình:</span> {p.projectName}</div>}
        {p.deliveryAddress && <div className="col-span-2"><span className="text-slate-600">{p.deliverToLabel ?? "Giao đến"}:</span> {p.deliveryAddress}</div>}
      </div>

      <div className="mt-3 border-y border-dashed border-black py-1 text-[10px] font-bold uppercase tracking-wide">
        <span>{p.cols.product}</span>
        <span className="float-right">{p.cols.lineTotal}</span>
      </div>
      <div className="divide-y divide-dashed divide-slate-400">
        {p.items.map((i) => (
          <div key={i.id} className="py-2">
            <div className="pr-1 text-[11px] font-bold leading-snug">
              {i.name}
              {t.options.showSku && i.sku && <span className="ml-1 font-normal text-[9px] text-slate-600">[{i.sku}]</span>}
            </div>
            <div className="mt-0.5 flex items-end justify-between gap-3 text-[10px]">
              <span className="text-slate-700">{formatNumber(i.quantity)} {i.unitName} × {formatNumber(t.options.showLineDiscount || i.quantity <= 0 ? i.unitPrice : i.total / i.quantity)}</span>
              <span className="shrink-0 text-[11px] font-bold">{formatNumber(i.total)}</span>
            </div>
            {t.options.showLineDiscount && Number(i.discount ?? 0) > 0 && (
              <div className="text-[9.5px] text-slate-700">{p.cols.discount ?? "Giảm giá"}: {i.lineDiscountMode === "pct" && `${formatNumber(i.lineDiscountValue ?? 0)}% · `}−{formatNumber(Number(i.discount))}</div>
            )}
          </div>
        ))}
      </div>

      <section className="mt-2 border-y-2 border-black py-1.5">
        {visibleTotals.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 py-0.5">
            <span className="text-slate-700">{r.label}</span>
            <span>{r.negative ? "−" : ""}{formatNumber(r.value)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-black pt-1.5 text-[14px] font-black">
          <span>{p.grandTotalLabel}</span>
          <span className="shrink-0">{formatCurrency(p.grandTotal)}</span>
        </div>
        {(p.afterTotals ?? []).map((r) => (
          <div key={r.label} className={`flex justify-between gap-3 py-0.5 ${r.bold ? "font-bold" : ""}`}>
            <span className="text-slate-700">{r.label}</span>
            <span>{formatNumber(r.value)}</span>
          </div>
        ))}
      </section>

      {t.options.showInWords && (
        <div className="mt-2 text-[9.5px] italic leading-snug"><span className="not-italic font-bold">{p.inWordsLabel}:</span> {moneyToWords(p.grandTotal)}.</div>
      )}
      {p.note && <div className="mt-2 border-t border-dashed border-slate-400 pt-2 text-[9.5px]"><span className="font-bold">Ghi chú:</span> {p.note}</div>}
      {t.options.showPaymentQr && p.paymentQr && (
        <>
          <div className="mt-3 border-t-2 border-dashed border-black pt-2 text-center">
            <div className="font-bold uppercase">{p.paymentQr.title}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.paymentQr.qrImageUrl} alt={p.paymentQr.title} className="mx-auto my-1 h-32 w-32 object-contain" />
            <div className="text-[10px]">{p.paymentQr.bankLabel}: <b>{p.paymentQr.bankName}</b></div>
            <div className="text-[10px]">{p.paymentQr.accountLabel}: <b>{p.paymentQr.accountNumber}</b></div>
            <div className="text-[10px]">{p.paymentQr.nameLabel}: <b>{p.paymentQr.accountName}</b></div>
            <div className="text-[9px] text-slate-700">{p.paymentQr.referenceLabel}: {p.paymentQr.reference}</div>
          </div>
        </>
      )}
      {t.footerNote && (
        <div className="mt-3 border-t border-dashed border-slate-400 pt-2 text-center text-[9.5px] leading-snug">{t.footerNote}</div>
      )}
      <div className="mt-3 text-center text-[10px] font-bold uppercase tracking-wide">Cảm ơn quý khách!</div>
    </div>
  );
}
