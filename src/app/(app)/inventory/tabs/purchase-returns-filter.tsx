"use client";

import { useMemo, useState } from "react";
import { CalendarDays, SlidersHorizontal, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { LumaWebPicker } from "../../sales/tabs/filter-drawer-shared";
import { ORDER_TIME_PRESETS, resolveOrderTimePreset, isOrderDateRangeValid } from "@/lib/orders/filter-date-range";

type Option = { id: string; name: string };
type Props = { suppliers: Option[]; warehouses: Option[]; values: Record<string, string | undefined> };

const statuses = [{ value: "all", label: "Tất cả" }, { value: "completed", label: "Hoàn tất" }, { value: "draft", label: "Nháp" }];
const settlements = [{ value: "all", label: "Tất cả" }, { value: "unsettled", label: "Chưa đối trừ" }, { value: "partial", label: "Đối trừ một phần" }, { value: "settled", label: "Đã đối trừ" }];

export function PurchaseReturnsFilter({ suppliers, warehouses, values }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const applied = useMemo(() => ({ supplierId: values.supplierId ?? "", warehouseId: values.warehouseId ?? "", status: values.status ?? "all", settlement: values.settlement ?? "all", timePreset: values.timePreset ?? "all", from: values.from ?? "", to: values.to ?? "" }), [values]);
  const [draft, setDraft] = useState(applied);
  const activeCount = [draft.supplierId, draft.warehouseId, draft.status !== "all" ? draft.status : "", draft.settlement !== "all" ? draft.settlement : "", draft.timePreset !== "all" ? draft.timePreset : ""].filter(Boolean).length;
  const range = draft.timePreset === "custom" ? { from: draft.from, to: draft.to } : resolveOrderTimePreset(draft.timePreset as never) ?? { from: "", to: "" };

  function openDrawer() { setDraft(applied); setOpen(true); }
  function closeDrawer() { setDraft(applied); setOpen(false); }
  function apply() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    for (const key of ["supplierId", "warehouseId", "status", "settlement", "timePreset", "from", "to"]) next.delete(key);
    if (draft.supplierId) next.set("supplierId", draft.supplierId);
    if (draft.warehouseId) next.set("warehouseId", draft.warehouseId);
    if (draft.status !== "all") next.set("status", draft.status);
    if (draft.settlement !== "all") next.set("settlement", draft.settlement);
    if (draft.timePreset !== "all") next.set("timePreset", draft.timePreset);
    if (range.from) next.set("from", range.from);
    if (range.to) next.set("to", range.to);
    router.push(`?${next.toString()}`); setOpen(false);
  }
  return <>
    <button type="button" onClick={openDrawer} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-slate-700 hover:border-primary-400">
      <SlidersHorizontal className="h-4 w-4 text-primary-600" /> Bộ lọc {activeCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs text-white">{activeCount}</span>}
    </button>
    {open && <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Bộ lọc phiếu trả hàng" className="ml-auto flex h-full w-full max-w-[460px] flex-col bg-surface shadow-2xl">
        <header className="flex items-start justify-between border-b border-border px-6 py-5"><div><h2 className="text-xl font-bold">Bộ lọc phiếu trả hàng</h2><p className="mt-1 text-sm text-slate-500">{activeCount} điều kiện đang chọn</p></div><button type="button" aria-label="Đóng" onClick={closeDrawer} className="rounded-lg p-2 hover:bg-surface-2"><X className="h-5 w-5" /></button></header>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section><h3 className="mb-3 text-base font-bold">Tìm theo</h3><div className="space-y-3"><LumaWebPicker ariaLabel="Nhà cung cấp" name="supplierId" value={draft.supplierId} options={[{ value: "", label: "Tìm nhà cung cấp" }, ...suppliers.map((x) => ({ value: x.id, label: x.name }))]} onChange={(value) => setDraft((d) => ({ ...d, supplierId: value }))} /><LumaWebPicker ariaLabel="Kho xuất" name="warehouseId" value={draft.warehouseId} options={[{ value: "", label: "Tìm kho xuất" }, ...warehouses.map((x) => ({ value: x.id, label: x.name }))]} onChange={(value) => setDraft((d) => ({ ...d, warehouseId: value }))} /></div></section>
          <section><h3 className="mb-3 text-base font-bold">Thời gian</h3><LumaWebPicker ariaLabel="Khoảng thời gian" name="timePreset" value={draft.timePreset} options={ORDER_TIME_PRESETS.map((x) => ({ value: x.value, label: x.label }))} onChange={(value) => { const next = resolveOrderTimePreset(value as never); setDraft((d) => ({ ...d, timePreset: value, from: next?.from ?? "", to: next?.to ?? "" })); }} />{draft.timePreset === "custom" && <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-slate-500">Từ ngày<input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" /></label><label className="text-xs font-semibold text-slate-500">Đến ngày<input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" /></label></div>}{range.from && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><CalendarDays className="h-4 w-4 text-primary-600" />{range.from} – {range.to}</p>}</section>
          <section><h3 className="mb-3 text-base font-bold">Trạng thái phiếu</h3><LumaWebPicker ariaLabel="Trạng thái phiếu" name="status" value={draft.status} options={statuses} onChange={(value) => setDraft((d) => ({ ...d, status: value }))} /></section>
          <section><h3 className="mb-3 text-base font-bold">Đối trừ công nợ</h3><LumaWebPicker ariaLabel="Trạng thái đối trừ" name="settlement" value={draft.settlement} options={settlements} onChange={(value) => setDraft((d) => ({ ...d, settlement: value }))} /></section>
        </div>
        <footer className="flex gap-3 border-t border-border bg-surface px-6 py-4"><button type="button" onClick={() => setDraft({ supplierId: "", warehouseId: "", status: "all", settlement: "all", timePreset: "all", from: "", to: "" })} className="min-h-11 flex-1 rounded-lg border border-primary-600 px-4 text-sm font-bold text-primary-700">Xóa lọc</button><button type="button" disabled={draft.timePreset === "custom" && !isOrderDateRangeValid(draft.from, draft.to)} onClick={apply} className="min-h-11 flex-1 rounded-lg bg-primary-600 px-4 text-sm font-bold text-white disabled:opacity-50">Xem phiếu</button></footer>
      </aside>
    </div>}
  </>;
}
