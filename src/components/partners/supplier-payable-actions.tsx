"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, WalletCards } from "lucide-react";
import { createSupplierPayableEntry, paySupplierPayable } from "@/lib/actions/payables";
import { MoneyInput } from "@/components/ui/money-input";
import {
  DebtBalanceSummary,
  DebtDialogFooter,
  PartnerDebtDialog,
} from "@/components/partners/partner-debt-dialog";
import { cn, formatCurrency } from "@/lib/utils";

type Invoice = { id: string; code: string; createdAt: string; remaining: number };
export type SupplierPayableOverview = {
  currentDebt: number;
  invoices: Invoice[];
};

const requestId = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

export function SupplierPayableActions({
  supplierId,
  overview,
  onChanged,
}: {
  supplierId: string;
  overview: SupplierPayableOverview;
  onChanged: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"pay" | "adjust" | null>(null);
  return (
    <>
      <button type="button" onClick={() => setMode("pay")} disabled={overview.currentDebt <= 0} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-50 lg:min-h-0 lg:min-w-0">
        <WalletCards className="h-4 w-4" />Thanh toán
      </button>
      <button type="button" onClick={() => setMode("adjust")} className="inline-flex h-10 min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 hover:bg-surface-2 dark:text-slate-200 lg:min-h-0 lg:min-w-0">
        <Pencil className="h-4 w-4" />Điều chỉnh
      </button>
      {mode === "pay" && (
        <SupplierPaymentDialog
          supplierId={supplierId}
          overview={overview}
          onClose={() => setMode(null)}
          onChanged={onChanged}
        />
      )}
      {mode === "adjust" && (
        <SupplierAdjustmentDialog
          supplierId={supplierId}
          currentDebt={overview.currentDebt}
          onClose={() => setMode(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function SupplierPaymentDialog({
  supplierId,
  overview,
  onClose,
  onChanged,
}: {
  supplierId: string;
  overview: SupplierPayableOverview;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [allocations, setAllocations] = useState(() => overview.invoices.map((invoice) => ({ purchaseOrderId: invoice.id, amount: 0 })));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [clientRequestId] = useState(() => requestId("web-supplier-payable"));
  const allocationTotal = useMemo(
    () => allocations.reduce((sum, row) => sum + row.amount, 0),
    [allocations],
  );
  const valid = amount > 0 && amount <= overview.currentDebt + 0.01 &&
    allocationTotal <= amount + 0.01;

  function setPaymentAmount(value: number) {
    setAmount(value);
  }

  function submit() {
    if (!valid || pending) return;
    setError("");
    startTransition(async () => {
      const result = await paySupplierPayable({
        supplierId,
        amount,
        method,
        allocations: allocations.filter((row) => row.amount > 0),
        clientRequestId,
      });
      if (!result.ok) {
        setError("Không thể ghi nhận thanh toán. Vui lòng kiểm tra số tiền, phân bổ và quyền thao tác.");
        return;
      }
      await onChanged();
      onClose();
    });
  }

  return (
    <PartnerDebtDialog title="Thanh toán nhà cung cấp" onClose={onClose}>
      <div className="space-y-4">
        <DebtBalanceSummary value={overview.currentDebt} tone="warning" />
        <label className="block text-sm font-medium">
          Số tiền thanh toán
          <MoneyInput value={amount} min={0} max={overview.currentDebt} onChange={(value) => setPaymentAmount(value ?? 0)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-right" />
          <span className="mt-1 block text-xs text-slate-500">Tối đa {formatCurrency(overview.currentDebt)}</span>
        </label>
        <div>
          <div className="mb-1.5 text-sm font-medium">Phương thức thanh toán</div>
          <div className="grid grid-cols-2">
            {(["cash", "bank_transfer"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setMethod(value)} className={cn("min-h-11 border px-3 py-2 text-sm first:rounded-l-lg last:rounded-r-lg", method === value ? "border-primary-600 bg-primary-600 text-white" : "border-border", "min-w-11 lg:min-w-0")}>
                {value === "cash" ? "Tiền mặt" : "Chuyển khoản"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">Phân bổ phiếu nhập</div>
          <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-2">
            {overview.invoices.length === 0 ? (
              <p className="p-2 text-sm text-slate-500">Không có phiếu nhập còn nợ; khoản thanh toán sẽ được ghi nhận chưa phân bổ.</p>
            ) : overview.invoices.map((invoice, index) => (
              <div key={invoice.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{invoice.code}<span className="ml-2 text-slate-400">còn {formatCurrency(invoice.remaining)}</span></span>
                <MoneyInput
                  value={allocations[index]?.amount ?? 0}
                  min={0}
                  max={invoice.remaining}
                  onChange={(value) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: value ?? 0 } : row))}
                  className="w-32 rounded border border-border px-2 py-1 text-right"
                />
              </div>
            ))}
          </div>
        </div>
        <p className={cn("text-xs", valid ? "text-slate-500" : "text-er")}>Tổng phân bổ: {formatCurrency(allocationTotal)}{amount > allocationTotal ? ` · Chưa phân bổ: ${formatCurrency(amount - allocationTotal)}` : ""}{valid ? "" : " — không được vượt số tiền thanh toán."}</p>
        {error && <p className="text-sm text-er">{error}</p>}
        <DebtDialogFooter onCancel={onClose} onConfirm={submit} confirmLabel={pending ? "Đang ghi nhận..." : "Xác nhận thanh toán"} disabled={!valid || pending} />
      </div>
    </PartnerDebtDialog>
  );
}

function SupplierAdjustmentDialog({
  supplierId,
  currentDebt,
  onClose,
  onChanged,
}: {
  supplierId: string;
  currentDebt: number;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [clientRequestId] = useState(() => requestId("web-supplier-payable-entry"));
  const valid = amount !== 0 && reason.trim().length > 0 && amount >= -currentDebt;

  function submit() {
    if (!valid || pending) return;
    setError("");
    startTransition(async () => {
      const result = await createSupplierPayableEntry({
        supplierId,
        amount,
        reason: reason.trim(),
        clientRequestId,
      });
      if (!result.ok) {
        setError("Không thể điều chỉnh công nợ. Thao tác này yêu cầu quyền quản lý.");
        return;
      }
      await onChanged();
      onClose();
    });
  }

  return (
    <PartnerDebtDialog title="Điều chỉnh công nợ" onClose={onClose}>
      <div className="space-y-4">
        <DebtBalanceSummary value={currentDebt} tone="warning" />
        <label className="block text-sm font-medium">
          Số tiền
          <MoneyInput value={amount} min={-currentDebt} onChange={(value) => setAmount(value ?? 0)} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-right" />
          <span className="mt-1 block text-xs text-slate-500">Nhập số dương để tăng nợ; nhập số âm để giảm nợ.</span>
        </label>
        <label className="block text-sm font-medium">
          Lý do
          <textarea value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-border p-2" />
          <span className="mt-1 block text-right text-xs text-slate-400">{reason.length}/200</span>
        </label>
        {error && <p className="text-sm text-er">{error}</p>}
        <DebtDialogFooter onCancel={onClose} onConfirm={submit} confirmLabel={pending ? "Đang lưu..." : "Xác nhận"} disabled={!valid || pending} />
      </div>
    </PartnerDebtDialog>
  );
}
