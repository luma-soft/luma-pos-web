"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Landmark } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { prepareTaxDeclaration, updateBankTaxRegistration, updateTaxDeclarationStatus } from "@/lib/actions/accounting";
import { currentDeclarationPeriod, occurrenceDeclarationPeriod } from "@/lib/accounting/declaration-period";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { getAccountingAuxiliaryBooks } from "@/lib/data/accounting";

type Books = Awaited<ReturnType<typeof getAccountingAuxiliaryBooks>>;

export function TaxDeclarationsClient({ declarations, bankAccounts, filingFrequency }: { declarations: Books["declarations"]; bankAccounts: Books["bankAccounts"]; filingFrequency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [occurrenceDate, setOccurrenceDate] = useState(() => localDateValue(new Date()));
  const period = filingFrequency === "per_occurrence" ? occurrenceDeclarationPeriod(occurrenceDate) : currentDeclarationPeriod(filingFrequency);
  const runAction = (action: () => Promise<{ ok: true; data: void } | { ok: false; error: string }>, success: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({ tone: result.ok ? "success" : "error", text: result.ok ? success : result.error });
      if (result.ok) router.refresh();
    });
  };
  const columns: DataTableColumn<Books["declarations"][number]>[] = [
    { key: "periodKey", label: "Kỳ kê khai", required: true, width: "150px", render: (row) => <span className="font-bold">{row.periodKey}</span> },
    { key: "revenue", label: "Doanh thu", required: true, align: "right", width: "170px", render: (row) => formatCurrency(row.revenue) },
    { key: "vatAmount", label: "Thuế GTGT", required: true, align: "right", width: "150px", render: (row) => formatCurrency(row.vatAmount) },
    { key: "pitAmount", label: "Thuế TNCN", required: true, align: "right", width: "150px", render: (row) => formatCurrency(row.pitAmount) },
    { key: "status", label: "Trạng thái", required: true, width: "180px", render: (row) => <Select value={row.status} disabled={pending} onValueChange={(status) => runAction(() => updateTaxDeclarationStatus(row.id, status as "draft" | "ready" | "submitted" | "accepted" | "rejected"), "Đã cập nhật trạng thái tờ khai.")} options={STATUS_OPTIONS} /> },
    { key: "submittedAt", label: "Ngày nộp", defaultVisible: true, width: "150px", render: (row) => row.submittedAt ? formatDate(row.submittedAt) : "—" },
  ];
  const totalTax = declarations.reduce((sum, row) => sum + row.vatAmount + row.pitAmount, 0);
  return <div className="space-y-5">
    {message ? <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${message.tone === "success" ? "border-ok/30 bg-ok/5 text-ok" : "border-er/30 bg-er/5 text-er"}`}>{message.text}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2"><Summary label="Tổng doanh thu đã lập tờ khai" value={formatCurrency(declarations.reduce((sum, row) => sum + row.revenue, 0))} /><Summary label="Tổng tiền thuế" value={formatCurrency(totalTax)} /></section>
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><FileCheck2 className="h-5 w-5 text-primary-700" />Tờ khai thuế</h2><p className="text-sm text-slate-500">Số liệu được khóa thành snapshot khi chuẩn bị tờ khai.</p>{filingFrequency === "per_occurrence" ? <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600"><span>Ngày phát sinh</span><Input className="h-9 w-40" type="date" value={occurrenceDate} onChange={(event) => setOccurrenceDate(event.target.value)} /></label> : null}</div><Button disabled={pending || !period} onClick={() => period && runAction(() => prepareTaxDeclaration(period), `Đã chuẩn bị tờ khai kỳ ${period.periodKey}.`)}>{pending ? "Đang xử lý…" : filingFrequency === "per_occurrence" ? "Chuẩn bị ngày đã chọn" : "Chuẩn bị kỳ hiện tại"}</Button></div><DataTableShell tableId="tax.declarations" rows={declarations} columns={columns} getRowId={(row) => row.id} minWidth="940px" empty={<Empty text="Chưa có tờ khai. Hãy chuẩn bị kỳ hiện tại sau khi đã phân loại doanh thu." />} /></section>
    <section className="space-y-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Landmark className="h-5 w-5 text-primary-700" />Bảng kê tài khoản ngân hàng, ví điện tử (01/BK-STK)</h2><p className="text-sm text-slate-500">Đồng bộ từ tài khoản đã cấu hình ở phần Thanh toán.</p></div><div className="overflow-hidden rounded-card border border-border bg-surface"><div className="grid grid-cols-[1fr_1fr_190px] gap-3 bg-surface-2 px-4 py-3 text-xs font-bold uppercase text-slate-500"><span>Tài khoản</span><span>Chủ tài khoản</span><span>Trạng thái kê khai</span></div>{bankAccounts.length === 0 ? <Empty text="Chưa có tài khoản thanh toán." /> : bankAccounts.map((account) => <div key={account.id} className="grid grid-cols-1 gap-2 border-t border-border px-4 py-3 sm:grid-cols-[1fr_1fr_190px] sm:items-center"><div><div className="font-bold">{account.accountNumber}</div><div className="text-xs text-slate-400">{account.bankCode}</div></div><div>{account.accountName}</div><Select value={account.status} disabled={pending} onValueChange={(status) => runAction(() => updateBankTaxRegistration(account.id, status as "not_declared" | "declared" | "inactive"), "Đã cập nhật trạng thái kê khai tài khoản.")} options={[{ value: "not_declared", label: "Chưa kê khai" }, { value: "declared", label: "Đã kê khai" }, { value: "inactive", label: "Ngừng sử dụng" }]} /></div>)}</div></section>
  </div>;
}

const STATUS_OPTIONS = [{ value: "draft", label: "Bản nháp" }, { value: "ready", label: "Sẵn sàng" }, { value: "submitted", label: "Đã nộp" }, { value: "accepted", label: "Đã chấp nhận" }, { value: "rejected", label: "Bị từ chối" }];
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-card border border-border bg-surface p-4 shadow-e1"><div className="text-xs font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-black tabular-nums">{value}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="p-10 text-center text-sm text-slate-400">{text}</div>; }
function localDateValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
