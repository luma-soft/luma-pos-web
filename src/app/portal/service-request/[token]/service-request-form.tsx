"use client";

import { useState } from "react";

export function ServiceRequestForm({
  token,
  defaultContactName,
  defaultContactPhone,
}: {
  token: string;
  defaultContactName: string;
  defaultContactPhone: string;
}) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (sent) {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm font-semibold text-emerald-800">
        Đã gửi yêu cầu. Bộ phận kỹ thuật sẽ liên hệ theo thông tin bạn cung cấp.
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        const response = await fetch(`/api/portal/service-request/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form.entries())),
        });
        setBusy(false);
        if (response.ok) setSent(true);
        else setError("Không thể gửi yêu cầu. Liên kết có thể đã hết hạn.");
      }}
    >
      <label className="block text-sm font-semibold">
        Tiêu đề
        <input name="title" required minLength={3} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm font-semibold">
        Mô tả tình trạng
        <textarea name="description" required minLength={5} rows={5} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Người liên hệ
          <input name="contactName" required defaultValue={defaultContactName} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm font-semibold">
          Số điện thoại
          <input name="contactPhone" required defaultValue={defaultContactPhone} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        Mức độ
        <select name="priority" defaultValue="normal" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
          <option value="low">Thấp</option>
          <option value="normal">Bình thường</option>
          <option value="high">Cao</option>
          <option value="urgent">Khẩn cấp</option>
        </select>
      </label>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
        {busy ? "Đang gửi…" : "Gửi yêu cầu"}
      </button>
    </form>
  );
}
