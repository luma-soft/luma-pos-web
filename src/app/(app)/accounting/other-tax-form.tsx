"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { createOtherTaxObligation } from "@/lib/actions/accounting";

export function OtherTaxForm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  if (!open) return <div className="flex justify-end"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Thêm nghĩa vụ thuế</Button></div>;
  return (
    <form className="grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      startTransition(async () => {
        const result = await createOtherTaxObligation({ occurredOn: form.get("occurredOn"), taxType: form.get("taxType"), description: form.get("description"), reference: form.get("reference"), payableAmount: Number(form.get("payableAmount")), paidAmount: Number(form.get("paidAmount")), dueOn: form.get("dueOn") });
        if (result.ok) { setOpen(false); setMessage(""); } else setMessage(result.error);
      });
    }}>
      <label className="space-y-1 text-sm font-medium"><span>Ngày ghi nhận</span><input required type="date" name="occurredOn" defaultValue={today} className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      <label className="space-y-1 text-sm font-medium"><span>Loại thuế</span><Select name="taxType" defaultValue="excise" options={[{ value: "excise", label: "Thuế tiêu thụ đặc biệt" }, { value: "resource", label: "Thuế tài nguyên" }, { value: "environment", label: "Thuế bảo vệ môi trường" }, { value: "import_export", label: "Thuế xuất/nhập khẩu" }, { value: "land", label: "Thuế sử dụng đất" }, { value: "other", label: "Thuế khác" }]} /></label>
      <label className="space-y-1 text-sm font-medium sm:col-span-2"><span>Diễn giải</span><input required name="description" className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      <label className="space-y-1 text-sm font-medium"><span>Chứng từ</span><input name="reference" className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      <label className="space-y-1 text-sm font-medium"><span>Số phải nộp</span><input required type="number" min="0" name="payableAmount" className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      <label className="space-y-1 text-sm font-medium"><span>Đã nộp</span><input required type="number" min="0" defaultValue="0" name="paidAmount" className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      <label className="space-y-1 text-sm font-medium"><span>Hạn nộp</span><input type="date" name="dueOn" className="h-11 w-full rounded-xl border border-border bg-surface px-3" /></label>
      {message && <div className="text-sm font-medium text-er sm:col-span-2 lg:col-span-4">{message}</div>}
      <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu"}</Button></div>
    </form>
  );
}
