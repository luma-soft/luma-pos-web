"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import {
  applyUnitPriceChoice, buildUnitPriceReview,
  type UnitPriceBook, type UnitPriceChoice, type UnitPricePreviewRow, type UnitPricingSnapshot,
} from "@/lib/products/unit-price-edit";

const money = (value: number | null) => value == null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)} đ`;
const number = (value: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(value);
type SiblingScope = { count: number; pricing: boolean; units: boolean };

export function UnitPricePreview({ title, rows, baseUnit }: { title: string; rows: UnitPricePreviewRow[]; baseUnit: string }) {
  return <section className="overflow-hidden rounded-xl border border-border">
    <h3 className="bg-surface-2 px-4 py-2.5 text-sm font-semibold">{title}</h3>
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500"><tr>
        <th scope="col" className="px-4 py-2 text-left font-medium">Đơn vị</th>
        <th scope="col" className="px-3 py-2 text-right font-medium">Giá cũ</th>
        <th scope="col" className="px-4 py-2 text-right font-medium">Giá sau khi lưu</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border-soft">
        <th scope="row" className="px-4 py-2.5 text-left font-normal">
          <span className="font-medium">{row.unitName}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{row.mode === "base" ? "Đơn vị gốc" : row.mode === "removed" ? "Xóa đơn vị" : `${row.mode === "fixed" ? "Giá riêng" : "Quy đổi"} · 1 ${row.unitName} = ${number(row.multiplier)} ${baseUnit}`}</span>
        </th>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-500">{money(row.before)}</td>
        <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{money(row.after)}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

/** Content is independently renderable for semantic/preview tests. */
export function UnitPriceConfirmationContent({ name, before, draft, books = [], siblingScope, mode, source, onMode, onSource, onCancel, onConfirm, titleId, descriptionId }: {
  name: string; before: UnitPricingSnapshot; draft: UnitPricingSnapshot; books?: UnitPriceBook[];
  siblingScope?: SiblingScope;
  mode: UnitPriceChoice; source: string | null;
  onMode: (mode: UnitPriceChoice) => void; onSource: (source: string) => void;
  onCancel: () => void; onConfirm: () => void; titleId: string; descriptionId: string;
}) {
  const initialReview = buildUnitPriceReview(before, draft, books);
  const validSource = initialReview.sources.some((candidate) => candidate.key === source);
  const awaitingSource = mode === "sync" && !validSource;
  const projected = awaitingSource ? draft : applyUnitPriceChoice(draft, mode, source);
  const preview = buildUnitPriceReview(before, projected, books);

  return <>
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div><h2 id={titleId} className="text-lg font-bold">Xác nhận thay đổi giá</h2>
        <p id={descriptionId} className="mt-1 text-sm text-slate-500">{name} · Kiểm tra giá theo từng đơn vị trước khi lưu.</p></div>
      <button type="button" onClick={onCancel} aria-label="Quay lại sửa sản phẩm" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-surface-2"><X className="h-5 w-5" /></button>
    </header>
    <div className="min-h-0 overflow-y-auto px-5 py-3">
      {initialReview.canSynchronize && <fieldset className="mb-4 space-y-2">
        <legend className="mb-2 text-sm font-semibold">Cách cập nhật Giá chung</legend>
        {([
          ["keep", "Giữ giá riêng", "Giữ giá riêng đã nhập; đơn vị còn lại tính theo giá gốc mới."],
          ["sync", "Đồng bộ theo tỷ lệ", "Lấy giá từ một đơn vị; chuyển các giá riêng về quy đổi."],
        ] as const).map(([value, label, hint]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${mode === value ? "border-primary-600 bg-primary-50/50 dark:bg-primary-950/30" : "border-border"}`}>
          <input type="radio" name={`${titleId}-mode`} value={value} checked={mode === value} onChange={() => onMode(value)} className="mt-1 accent-teal-700" />
          <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span></span>
        </label>)}
        {mode === "sync" && <div className="pt-2">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Lấy giá từ đơn vị</legend>
            <div className="flex flex-wrap gap-2">{initialReview.sources.map((candidate) => <label key={candidate.key}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${source === candidate.key ? "border-primary-600 bg-primary-50/50 dark:bg-primary-950/30" : "border-border"}`}>
              <input type="radio" name={`${titleId}-source`} checked={source === candidate.key} onChange={() => onSource(candidate.key)} className="accent-teal-700" />
              {candidate.label} · {money(candidate.amount)}
            </label>)}</div>
          </fieldset>
          {awaitingSource && <p role="status" className="mt-2 text-sm text-amber-700">Các giá vừa nhập chưa cùng tỷ lệ. Chọn rõ đơn vị làm giá nguồn để xem kết quả.</p>}
          {!awaitingSource && <p className="mt-2 text-xs text-slate-500">Giá gốc làm tròn đến 2 số lẻ; giá quy đổi làm tròn đến đồng.</p>}
        </div>}
      </fieldset>}
      {awaitingSource ? <p className="py-4 text-sm text-slate-500">Chưa tính giá mới vì chưa chọn nguồn.</p> : <div className="space-y-3" aria-live="polite">
        {initialReview.canSynchronize && <UnitPricePreview title="Giá chung" rows={preview.retailRows} baseUnit={draft.baseUnit} />}
        {preview.additionalBooks.map((book) => <UnitPricePreview key={book.key} title={book.label} rows={book.rows} baseUnit={draft.baseUnit} />)}
      </div>}
      {siblingScope && (siblingScope.pricing || siblingScope.units) && <p role="note" className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        Bạn đã chọn áp dụng {siblingScope.pricing && siblingScope.units ? "giá và đơn vị" : siblingScope.pricing ? "giá" : "đơn vị"} cho {siblingScope.count} sản phẩm cùng loại. Bảng trên chỉ xem trước sản phẩm đang sửa.
        {siblingScope.units && mode === "sync" && " Giá riêng theo đơn vị của các sản phẩm đó cũng sẽ được xóa; giá quy đổi sẽ tính từ giá gốc của từng sản phẩm sau khi lưu."}
      </p>}
      <p className="mt-4 text-xs leading-5 text-slate-500">Lưu theo phạm vi áp dụng đã chọn. Lựa chọn đồng bộ không đổi giá gốc của bảng giá khác hoặc chứng từ đã lập.</p>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
      <Button type="button" variant="outline" onClick={onCancel}>Quay lại</Button>
      <Button type="button" disabled={awaitingSource} onClick={onConfirm}>Xác nhận &amp; lưu</Button>
    </footer>
  </>;
}

export function UnitPriceConfirmation<T extends UnitPricingSnapshot>({ name, before, draft, books, siblingScope, onCancel, onConfirm }: {
  name: string; before: UnitPricingSnapshot; draft: T; books: UnitPriceBook[];
  siblingScope?: SiblingScope;
  onCancel: () => void; onConfirm: (value: T) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<UnitPriceChoice>("keep");
  const [source, setSource] = useState<string | null>(() => buildUnitPriceReview(before, draft, books).suggestedSource);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // This nested confirmation must not close the product form behind it.
        event.preventDefault(); event.stopImmediatePropagation(); onCancel();
      } else if (event.key === "Tab" && dialog) {
        const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); previous?.focus(); };
  }, [onCancel]);

  if (typeof document === "undefined") return null;
  return createPortal(<div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6" onMouseDown={onCancel}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1}
      className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-2xl outline-none"
      onMouseDown={(event) => event.stopPropagation()}>
      <UnitPriceConfirmationContent name={name} before={before} draft={draft} books={books} siblingScope={siblingScope} mode={mode} source={source} onMode={setMode} onSource={setSource}
        titleId={`${id}-title`} descriptionId={`${id}-description`} onCancel={onCancel} onConfirm={() => onConfirm(applyUnitPriceChoice(draft, mode, source))} />
    </div>
  </div>, document.body);
}
