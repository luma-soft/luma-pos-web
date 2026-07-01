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
          ? "bg-white text-black w-[794px] min-h-[1000px] p-12 text-[13px] shadow-lg print:shadow-none"
          : "bg-white text-black w-[559px] min-h-[794px] p-10 text-[12.5px] shadow-lg print:shadow-none"
      }
    >
      {/* header */}
      <div className="flex justify-between border-b-2 border-black pb-3">
        <div>
          <div className={isA4 ? "font-bold text-[18px]" : "font-bold text-[16px]"}>{t.storeName || "—"}</div>
          <div className="text-[11px] text-slate-600">
            {t.storeAddress}
            {t.storePhone && <><br />ĐT: {t.storePhone}</>}
            {t.storeTaxCode && <> · MST: {t.storeTaxCode}</>}
          </div>
        </div>
        <div className="text-right">
          <div className={isA4 ? "font-bold text-[17px]" : "font-bold text-[15px]"}>{p.title}</div>
          <div className="text-[11px] text-slate-600">
            Số: <b>{p.code}</b><br />
            Ngày: {formatDate(p.date)}
          </div>
        </div>
      </div>

      {/* party */}
      <div className="flex justify-between my-3 text-[12px]">
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
      <table className="w-full border-collapse text-[12px]">
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
            <tr key={i.id}>
              <td className="border border-slate-400 px-2 py-1.5">
                {i.name}
                {t.options.showSku && i.sku && <span className="text-slate-500 text-[10px]"> ({i.sku})</span>}
              </td>
              <td className="border border-slate-400 px-2 py-1.5 text-center">{i.unitName}</td>
              <td className="border border-slate-400 px-2 py-1.5 text-center">{formatNumber(i.quantity)}</td>
              <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(i.unitPrice)}</td>
              {showLineDiscount && <td className="border border-slate-400 px-2 py-1.5 text-right">{Number(i.discount ?? 0) > 0 ? formatNumber(Number(i.discount)) : "—"}</td>}
              <td className="border border-slate-400 px-2 py-1.5 text-right">{formatNumber(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="flex justify-end mt-3 text-[12px]">
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
        <div className="text-[11px] text-slate-600 mt-2 italic">
          {p.inWordsLabel}: {moneyToWords(p.grandTotal)}.
        </div>
      )}

      {t.options.showPaymentQr && p.paymentQr && (
        <div className="mt-3 flex gap-3 rounded border border-slate-300 p-2 text-[11px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.paymentQr.qrImageUrl} alt={p.paymentQr.title} className="h-24 w-24 object-contain" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{p.paymentQr.title}</div>
            <div>{p.paymentQr.bankLabel}: <b>{p.paymentQr.bankName}</b></div>
            <div>{p.paymentQr.accountLabel}: <b className="font-mono">{p.paymentQr.accountNumber}</b></div>
            <div>{p.paymentQr.nameLabel}: <b>{p.paymentQr.accountName}</b></div>
            <div>{p.paymentQr.referenceLabel}: <b className="font-mono">{p.paymentQr.reference}</b></div>
          </div>
        </div>
      )}

      {p.note && <div className="text-[11px] mt-2"><b>Ghi chú:</b> {p.note}</div>}

      {t.options.showSignatures && p.signatures && (
        <div className={`flex justify-between text-center text-[12px] ${isA4 ? "mt-14" : "mt-10"}`}>
          {p.signatures.map((s) => (
            <div key={s}><b>{s}</b><br /><i className="text-[10px] text-slate-500">{p.signHint ?? "(ký, họ tên)"}</i></div>
          ))}
        </div>
      )}

      {t.footerNote && (
        <div className="border-t border-dashed border-slate-400 mt-8 pt-2 text-[10px] text-slate-500 text-center">
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
    <div className="bg-white text-black w-[302px] p-4 font-mono text-[12px] leading-relaxed shadow-lg print:shadow-none">
      <div className="text-center">
        <div className="font-bold text-[14px]">{t.storeName || "—"}</div>
        {(t.storeAddress || t.storePhone) && (
          <div className="text-[10.5px]">{t.storeAddress}{t.storePhone ? ` · ${t.storePhone}` : ""}</div>
        )}
        <div className="border-t border-dashed border-slate-400 my-2" />
        <div className="font-bold">{p.title}</div>
        <div className="text-[11px]">{p.code} · {formatDate(p.date)}{t.options.showSeller && p.sellerName ? ` · ${p.sellerName}` : ""}</div>
      </div>
      <div className="border-t border-dashed border-slate-400 my-2" />
      <div className="text-[11px]">
        {p.partyLabel}: {p.partyName}
        {t.options.showProject && p.projectName && <><br />CT: {p.projectName}</>}
      </div>
      <div className="border-t border-dashed border-slate-400 my-2" />
      {p.items.map((i) => (
        <div key={i.id} className="mb-1.5">
          {i.name}<br />
          {formatNumber(i.quantity)} {i.unitName} × {formatNumber(i.unitPrice)}
          {t.options.showLineDiscount && Number(i.discount ?? 0) > 0 && <><br />{p.cols.discount ?? "Giảm giá"}: −{formatNumber(Number(i.discount))}</>}
          <span className="float-right">{formatNumber(i.total)}</span>
        </div>
      ))}
      <div className="border-t border-dashed border-slate-400 my-2" />
      {visibleTotals.map((r) => (
        <div key={r.label}>{r.label}<span className="float-right">{r.negative ? "−" : ""}{formatNumber(r.value)}</span></div>
      ))}
      <div className="font-bold text-[14px] mt-1">{p.grandTotalLabel}<span className="float-right">{formatNumber(p.grandTotal)}</span></div>
      {(p.afterTotals ?? []).map((r) => (
        <div key={r.label} className={r.bold ? "font-bold" : ""}>{r.label}<span className="float-right">{formatNumber(r.value)}</span></div>
      ))}
      {t.options.showPaymentQr && p.paymentQr && (
        <>
          <div className="border-t border-dashed border-slate-400 my-2" />
          <div className="text-center font-bold">{p.paymentQr.title}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.paymentQr.qrImageUrl} alt={p.paymentQr.title} className="mx-auto my-1 h-36 w-36 object-contain" />
          <div>{p.paymentQr.bankLabel}: {p.paymentQr.bankName}</div>
          <div>{p.paymentQr.accountLabel}: {p.paymentQr.accountNumber}</div>
          <div>{p.paymentQr.nameLabel}: {p.paymentQr.accountName}</div>
          <div>{p.paymentQr.referenceLabel}: {p.paymentQr.reference}</div>
        </>
      )}
      {t.footerNote && (
        <>
          <div className="border-t border-dashed border-slate-400 my-2" />
          <div className="text-center text-[10.5px]">{t.footerNote}</div>
        </>
      )}
    </div>
  );
}
