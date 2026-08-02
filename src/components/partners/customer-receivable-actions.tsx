"use client";

import { useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { Pencil, QrCode, WalletCards, X } from "lucide-react";
import { collectCustomerReceivable, createCustomerReceivableEntry } from "@/lib/actions/receivables";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";

type Invoice = { id: string; code: string; createdAt: string; remaining: number };
type Overview = { currentDebt: number; invoices: Invoice[] };
type Mode = "collect" | "adjust" | "discount" | "qr";

const requestId = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

function allocate(invoices: Invoice[], amount: number) {
  let remaining = amount;
  return invoices.map((invoice) => {
    const value = Math.min(invoice.remaining, remaining);
    remaining -= value;
    return { orderId: invoice.id, amount: value };
  });
}

export function CustomerReceivableActions({
  customerId,
  currentDebt,
}: {
  customerId: string;
  currentDebt: number;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState<{ imageUrl: string; reference: string; amount: number } | null>(null);

  async function open(next: Mode) {
    setMode(next);
    setError("");
    if (next !== "collect" && next !== "qr") return;
    setLoading(true);
    try {
      const response = await fetch(`/api/mobile/customers/${encodeURIComponent(customerId)}/receivables`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error();
      setOverview(json.data as Overview);
    } catch {
      setError("Không tải được các hóa đơn còn nợ.");
    } finally {
      setLoading(false);
    }
  }

  async function createQr(invoice: Invoice, amount: number) {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/payments/sepay", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: invoice.id, amount, reference: requestId("debt-qr").slice(0, 40) }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok || !json.data?.qrImageUrl) throw new Error();
      setQr({ imageUrl: json.data.qrImageUrl, reference: json.data.reference, amount: json.data.amount }); setMode(null);
    } catch {
      setError("Không tạo được QR. Vui lòng kiểm tra số tiền.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => open("collect")} disabled={currentDebt <= 0} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-50 lg:min-h-0 lg:min-w-0">
        <WalletCards className="h-4 w-4" />Thanh toán
      </button>
      <button type="button" onClick={() => open("adjust")} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 hover:bg-surface-2 dark:text-slate-200 lg:min-h-0 lg:min-w-0">
        <Pencil className="h-4 w-4" />Điều chỉnh
      </button>
      <button type="button" onClick={() => open("discount")} disabled={currentDebt <= 0} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-200 lg:min-h-0 lg:min-w-0">
        <WalletCards className="h-4 w-4" />Chiết khấu thanh toán
      </button>
      <button type="button" onClick={() => open("qr")} disabled={currentDebt <= 0 || loading} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-200 lg:min-h-0 lg:min-w-0"><QrCode className="h-4 w-4" />Tạo QR</button>
      {mode === "collect" && loading && <Dialog title="Thu công nợ" onClose={() => setMode(null)}><p className="text-sm text-slate-500">Đang tải hóa đơn...</p></Dialog>}
      {mode === "collect" && !loading && <CollectDialog customerId={customerId} overview={overview} error={error} onError={setError} onClose={() => setMode(null)} />}
      {mode === "qr" && loading && <Dialog title="Tạo QR thanh toán" onClose={() => setMode(null)}><p className="text-sm text-slate-500">Đang tải hóa đơn...</p></Dialog>}
      {mode === "qr" && !loading && <QrCreateDialog invoices={overview?.invoices ?? []} error={error} onCreate={createQr} onClose={() => setMode(null)} />}
      {(mode === "adjust" || mode === "discount") && <EntryDialog customerId={customerId} mode={mode} error={error} onError={setError} onClose={() => setMode(null)} />}
      {qr && <Dialog title="QR thanh toán" onClose={() => setQr(null)}><div className="space-y-3 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- provider-returned VietQR URL is not a Next image asset. */}
        <img src={qr.imageUrl} alt="QR thanh toán" className="mx-auto h-64 w-64 rounded-lg border border-border" />
        <p className="text-sm">{formatCurrency(qr.amount)}</p><p className="text-xs text-slate-500">Mã tham chiếu: {qr.reference}</p><p className="text-xs text-slate-500">QR này áp dụng cho hóa đơn còn nợ cũ nhất.</p>
      </div></Dialog>}
    </>
  );
}

function QrCreateDialog({ invoices, error, onCreate, onClose }: { invoices: Invoice[]; error: string; onCreate: (invoice: Invoice, amount: number) => Promise<void>; onClose: () => void }) {
  const [invoiceId, setInvoiceId] = useState(() => invoices[0]?.id ?? "");
  const invoice = invoices.find((row) => row.id === invoiceId) ?? invoices[0];
  const [amount, setAmount] = useState(() => invoice?.remaining ?? 0);
  const [pending, startTransition] = useTransition();
  function submit() {
    if (!invoice || amount <= 0 || amount > invoice.remaining || pending) return;
    startTransition(() => { void onCreate(invoice, amount); });
  }
  return <Dialog title="Tạo QR thanh toán" onClose={onClose}>
    {!invoice ? <p className="text-sm text-er">Không có hóa đơn còn nợ.</p> : <div className="space-y-4">
      <label className="block text-sm font-medium">Hóa đơn<Select value={invoice.id} onValueChange={(value) => { const next = invoices.find((row) => row.id === value); setInvoiceId(value); setAmount(next?.remaining ?? 0); }} options={invoices.map((row) => ({ value: row.id, label: `${row.code} · còn ${formatCurrency(row.remaining)}` }))} searchable searchPlaceholder="Tìm mã hóa đơn" rootClassName="mt-1 w-full" menuMinWidth={440} /></label>
      <label className="block text-sm font-medium">Số tiền QR<MoneyInput value={amount} min={0} max={invoice.remaining} onChange={(value) => setAmount(value ?? 0)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-right" /></label>
      <p className="text-xs text-slate-500">Có thể thu một phần, tối đa {formatCurrency(invoice.remaining)} cho hóa đơn này.</p>
      {error && <p className="text-sm text-er">{error}</p>}<button type="button" disabled={amount <= 0 || amount > invoice.remaining || pending} onClick={submit} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang tạo QR..." : "Tạo QR"}</button>
    </div>}
  </Dialog>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center" onMouseDown={onClose}>
    <section className="w-full max-w-xl rounded-card bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-surface-2"><X className="h-4 w-4" /></button></div>
      {children}
    </section>
  </div>;
}

function CollectDialog({ customerId, overview, error, onError, onClose }: { customerId: string; overview: Overview | null; error: string; onError: (value: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState(() => overview?.currentDebt ?? 0);
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "card">("cash");
  const [allocations, setAllocations] = useState<Array<{ orderId: string; amount: number }>>(() => allocate(overview?.invoices ?? [], overview?.currentDebt ?? 0));
  const [pending, startTransition] = useTransition();
  const allocationTotal = useMemo(() => allocations.reduce((sum, row) => sum + row.amount, 0), [allocations]);
  const valid = overview && amount > 0 && allocationTotal <= amount + 0.01;
  function setPaymentAmount(value: number) { setAmount(value); setAllocations(allocate(overview?.invoices ?? [], value)); }
  function submit() {
    if (!valid || pending) return;
    startTransition(async () => {
      const result = await collectCustomerReceivable({ customerId, amount, method, allocations: allocations.filter((row) => row.amount > 0), clientRequestId: requestId("web-receivable") });
      if (!result.ok) return onError("Không thể ghi nhận phiếu thu. Vui lòng kiểm tra số tiền và quyền thao tác.");
      onClose();
    });
  }
  return <Dialog title="Thu công nợ" onClose={onClose}>
    {!overview ? <p className="text-sm text-er">{error || "Không có dữ liệu công nợ."}</p> : <div className="space-y-4">
      <p className="text-sm text-slate-500">Công nợ hiện tại: <strong className="text-er">{formatCurrency(overview.currentDebt)}</strong></p>
      <label className="block text-sm font-medium">Số tiền<MoneyInput value={amount} min={0} max={overview.currentDebt} onChange={(value) => setPaymentAmount(value ?? 0)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-right" /></label>
      <div className="flex gap-2">{(["cash", "bank_transfer", "card"] as const).map((value) => <button key={value} type="button" onClick={() => setMethod(value)} className={cn("rounded-lg border px-3 py-2 text-sm", method === value ? "border-primary-600 bg-primary-600 text-white" : "border-border")}>{value === "cash" ? "Tiền mặt" : value === "bank_transfer" ? "Chuyển khoản" : "Thẻ"}</button>)}</div>
      <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-border p-2">{overview.invoices.map((invoice, index) => <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm"><span>{invoice.code}<span className="ml-2 text-slate-400">còn {formatCurrency(invoice.remaining)}</span></span><MoneyInput value={allocations[index]?.amount ?? 0} min={0} max={invoice.remaining} onChange={(value) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: value ?? 0 } : row))} className="w-32 rounded border border-border px-2 py-1 text-right" /></div>)}</div>
      <p className={cn("text-xs", valid ? "text-slate-500" : "text-er")}>Phân bổ hóa đơn: {formatCurrency(allocationTotal)}{amount > allocationTotal ? ` · Khách trả trước: ${formatCurrency(amount - allocationTotal)}` : ""}{valid ? "" : " — không được vượt số tiền thu."}</p>
      {error && <p className="text-sm text-er">{error}</p>}<button type="button" disabled={!valid || pending} onClick={submit} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang ghi nhận..." : "Xác nhận thu"}</button>
    </div>}
  </Dialog>;
}

function EntryDialog({ customerId, mode, error, onError, onClose }: { customerId: string; mode: "adjust" | "discount"; error: string; onError: (value: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState(0); const [reason, setReason] = useState(""); const [pending, startTransition] = useTransition();
  const signedAmount = mode === "discount" ? -Math.abs(amount) : amount;
  const type = mode === "discount" ? "settlement_discount" : signedAmount > 0 ? "adjustment_debit" : "adjustment_credit";
  function submit() { if (signedAmount === 0 || !reason.trim() || pending) return; startTransition(async () => { const result = await createCustomerReceivableEntry({ customerId, amount: signedAmount, type, reason, clientRequestId: requestId("web-receivable-entry") }); if (!result.ok) return onError("Không thể tạo chứng từ. Thao tác này yêu cầu quyền quản lý."); onClose(); }); }
  return <Dialog title={mode === "discount" ? "Chiết khấu thanh toán" : "Điều chỉnh công nợ"} onClose={onClose}><div className="space-y-4"><label className="block text-sm font-medium">Số tiền<MoneyInput value={amount} min={mode === "adjust" ? -Number.MAX_SAFE_INTEGER : 0} onChange={(value) => setAmount(value ?? 0)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-right" /></label>{mode === "adjust" && <p className="text-xs text-slate-500">Nhập số dương để tăng nợ; nhập số âm (ví dụ -1.000) khi cửa hàng nợ khách.</p>}<label className="block text-sm font-medium">Lý do<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2" /></label>{error && <p className="text-sm text-er">{error}</p>}<button type="button" disabled={amount === 0 || !reason.trim() || pending} onClick={submit} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu..." : "Xác nhận"}</button></div></Dialog>;
}
