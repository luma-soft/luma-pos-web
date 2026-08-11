"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CalendarDays, Warehouse, X } from "lucide-react";
import { FilterTriggerButton } from "@/components/list-search-filter";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collectFocusableElements,
  LumaDateRangePicker,
  LumaEntityPicker,
  LumaWebPicker,
} from "../../sales/tabs/filter-drawer-shared";
import {
  DEFAULT_TIME_FILTER_PRESET,
  ORDER_TIME_PRESETS,
  isOrderDateRangeValid,
  resolveOrderTimePreset,
} from "@/lib/orders/filter-date-range";

type Option = { id: string; name: string };
type Draft = {
  supplierId: string;
  warehouseId: string;
  status: string;
  settlement: string;
  timePreset: string;
  from: string;
  to: string;
};
type Props = {
  suppliers: Option[];
  warehouses: Option[];
  values: Record<string, string | undefined>;
  resultCount?: number;
};

const statuses = [
  { value: "all", label: "Tất cả" },
  { value: "completed", label: "Hoàn tất" },
  { value: "draft", label: "Nháp" },
];
const settlements = [
  { value: "all", label: "Tất cả" },
  { value: "unsettled", label: "Chưa đối trừ" },
  { value: "partial", label: "Đối trừ một phần" },
  { value: "settled", label: "Đã đối trừ" },
];

export function PurchaseReturnsFilter({ suppliers, warehouses, values, resultCount }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const applied = useMemo<Draft>(
    () => ({
      supplierId: values.supplierId ?? "",
      warehouseId: values.warehouseId ?? "",
      status: values.status ?? "all",
      settlement: values.settlement ?? "all",
      timePreset: values.timePreset ?? DEFAULT_TIME_FILTER_PRESET,
      from: values.from ?? "",
      to: values.to ?? "",
    }),
    [values],
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(applied);
  const [entityLabels, setEntityLabels] = useState({ supplier: "", warehouse: "" });
  const [previewCount, setPreviewCount] = useState<number | null>(resultCount ?? null);
  const activeCount = [
    draft.supplierId,
    draft.warehouseId,
    draft.status !== "all" ? draft.status : "",
    draft.settlement !== "all" ? draft.settlement : "",
    draft.timePreset !== "all" ? draft.timePreset : "",
  ].filter(Boolean).length;
  const range = draft.timePreset === "custom"
    ? { from: draft.from, to: draft.to }
    : resolveOrderTimePreset(draft.timePreset as never) ?? { from: "", to: "" };
  const dateError = draft.timePreset === "custom" && !isOrderDateRangeValid(draft.from, draft.to)
    ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm."
    : "";

  const closeDrawer = useCallback(() => {
    setDraft(applied);
    setEntityLabels({ supplier: "", warehouse: "" });
    setOpen(false);
  }, [applied]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const focusElements = () => collectFocusableElements(panelRef.current);
    window.requestAnimationFrame(() => focusElements()[0]?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? index <= 0 ? focusable.length - 1 : index - 1
        : index === -1 || index === focusable.length - 1 ? 0 : index + 1;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [closeDrawer, open]);

  useEffect(() => {
    if (!open || dateError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams({
        q: searchParams.get("q") ?? "",
        supplierId: draft.supplierId,
        warehouseId: draft.warehouseId,
        status: draft.status,
        settlement: draft.settlement,
        from: range.from,
        to: range.to,
      });
      try {
        const response = await fetch(`/api/inventory/purchase-returns/count?${query.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as { ok?: boolean; data?: { total?: unknown } };
        if (!response.ok || !payload.ok || typeof payload.data?.total !== "number") throw new Error("count_failed");
        setPreviewCount(payload.data.total);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPreviewCount(null);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dateError, draft, open, range.from, range.to, searchParams]);

  function openDrawer() {
    setDraft(applied);
    setEntityLabels({ supplier: "", warehouse: "" });
    setOpen(true);
  }

  function reset() {
    setDraft({ supplierId: "", warehouseId: "", status: "all", settlement: "all", timePreset: DEFAULT_TIME_FILTER_PRESET, from: "", to: "" });
    setEntityLabels({ supplier: "", warehouse: "" });
  }

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
    router.push(`?${next.toString()}`);
    setOpen(false);
  }

  return (
    <>
      <FilterTriggerButton ref={triggerRef} onClick={openDrawer} label="Lọc" active={activeCount > 0} />

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30" role="presentation" onMouseDown={closeDrawer}>
          <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="purchase-return-filter-title" className="ml-auto flex h-full w-full max-w-[460px] flex-col bg-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between border-b border-border px-6 py-5">
              <div><h2 id="purchase-return-filter-title" className="text-xl font-bold">Bộ lọc phiếu trả hàng</h2><p className="mt-1 text-sm text-slate-500">{activeCount} điều kiện đang chọn</p></div>
              <button type="button" aria-label="Đóng bộ lọc" onClick={closeDrawer} className="rounded-lg p-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"><X className="h-5 w-5 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" /></button>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section>
                <h3 className="mb-3 text-base font-bold">Tìm theo</h3>
                <div className="space-y-3">
                  <LumaEntityPicker label="Nhà cung cấp" name="supplierId" labelName="supplierLabel" kind="supplier" endpoint="/api/inventory/filter-options" value={draft.supplierId} labelValue={entityLabels.supplier || suppliers.find((option) => option.id === draft.supplierId)?.name || ""} placeholder="Tìm nhà cung cấp" icon={<Building2 className="size-5" />} onChange={(next) => { setDraft((current) => ({ ...current, supplierId: next.value })); setEntityLabels((current) => ({ ...current, supplier: next.label })); }} />
                  <LumaEntityPicker label="Kho xuất" name="warehouseId" labelName="warehouseLabel" kind="warehouse" endpoint="/api/inventory/filter-options" value={draft.warehouseId} labelValue={entityLabels.warehouse || warehouses.find((option) => option.id === draft.warehouseId)?.name || ""} placeholder="Tìm kho xuất" icon={<Warehouse className="size-5" />} onChange={(next) => { setDraft((current) => ({ ...current, warehouseId: next.value })); setEntityLabels((current) => ({ ...current, warehouse: next.label })); }} />
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-base font-bold">Thời gian</h3>
                <LumaWebPicker ariaLabel="Khoảng thời gian" name="timePreset" value={draft.timePreset} options={ORDER_TIME_PRESETS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => { const nextRange = resolveOrderTimePreset(value as never); setDraft((current) => ({ ...current, timePreset: value, from: nextRange?.from ?? "", to: nextRange?.to ?? "" })); }} />
                {draft.timePreset === "custom" ? (
                  <div className="mt-3"><LumaDateRangePicker fromName="from" toName="to" from={draft.from} to={draft.to} error={dateError} onChange={(from, to) => setDraft((current) => ({ ...current, from, to }))} /></div>
                ) : range.from ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><CalendarDays className="h-4 w-4 text-primary-600" />{range.from} – {range.to}</p>
                ) : null}
              </section>

              <section><h3 className="mb-3 text-base font-bold">Trạng thái</h3><LumaWebPicker ariaLabel="Trạng thái phiếu" name="status" value={draft.status} options={statuses} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} /></section>
              <section><h3 className="mb-3 text-base font-bold">Đối trừ công nợ</h3><LumaWebPicker ariaLabel="Trạng thái đối trừ" name="settlement" value={draft.settlement} options={settlements} onChange={(value) => setDraft((current) => ({ ...current, settlement: value }))} /></section>
            </div>

            <footer className="flex gap-3 border-t border-border bg-surface px-6 py-4">
              <button type="button" onClick={reset} className="min-h-11 flex-1 rounded-lg border border-primary-600 px-4 text-sm font-bold text-primary-700 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0">Xóa lọc</button>
              <button type="button" disabled={Boolean(dateError)} onClick={apply} className="min-h-11 flex-1 rounded-lg bg-primary-600 px-4 text-sm font-bold text-white disabled:opacity-50 min-w-11 lg:min-w-0 min-w-11 lg:min-w-0">Xem {previewCount == null ? "phiếu" : `${previewCount.toLocaleString("vi-VN")} phiếu`}</button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
