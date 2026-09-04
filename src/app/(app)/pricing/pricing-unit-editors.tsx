"use client";

import { useState } from "react";
import { MoneyInput } from "@/components/ui/money-input";
import { stopRowToggle } from "@/components/data-table";
import { isPriceBookReadOnly, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { canEditPricingUnit, pricingUnitValue } from "./pricing-price-edit";
import type { PricingBook, PricingRow } from "./pricing-table";

export const pricingMoneyLabel = (value: number | null) => value == null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)} đ`;
const quantity = (value: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(value);

function AlternatePriceEditor({ row, book, retailId, unitName, disabled, onCommit }: {
  row: PricingRow; book: PricingBook; retailId: string; unitName: string; disabled: boolean;
  onCommit: (value: number | null, unitName: string) => void;
}) {
  const value = pricingUnitValue(row, book, retailId, unitName);
  const [draft, setDraft] = useState<number | null>(value);
  const [previousRow, setPreviousRow] = useState(row);
  const [changed, setChanged] = useState(false);
  // Acknowledgement, cancellation and failed saves all supply a fresh row.
  if (previousRow !== row) { setPreviousRow(row); setDraft(value); setChanged(false); }
  const retail = systemPriceBookType(book) === "retail";
  return <MoneyInput decimals={2} value={draft ?? ""} disabled={disabled}
    aria-label={`${book.name} / ${unitName}`} placeholder={value == null ? "Chưa có giá" : undefined}
    title={retail ? "Để trống để trở lại giá quy đổi." : "Sửa giá này sẽ quy ngược về giá đơn vị gốc; chỉ xóa giá tại đơn vị gốc."}
    onChange={(next) => { setChanged(true); setDraft(next); }}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={() => {
      if (!changed || draft === value || (draft == null && !retail)) { setDraft(value); setChanged(false); return; }
      setChanged(false);
      onCommit(draft, unitName);
    }}
    className="min-h-10 w-full rounded-md border border-border bg-surface px-2 text-right text-sm tabular-nums disabled:opacity-60" />;
}

/** Every book repeats the same unit order, preserving product-level table rows. */
export function PricingUnitEditors({ row, book, retailId, disabled = false, onCommit }: {
  row: PricingRow; book: PricingBook; retailId: string; disabled?: boolean;
  onCommit: (value: number | null, unitName: string) => void;
}) {
  const units = (row.units ?? []).filter((unit) => unit.unitName !== row.baseUnit);
  if (!units.length) return null;
  return <div className="mt-2 space-y-2 text-left" onClick={stopRowToggle}>
    {units.map((unit) => {
      const editable = canEditPricingUnit(row, book, retailId, unit.unitName);
      const readOnly = isPriceBookReadOnly(book);
      const fixed = systemPriceBookType(book) === "retail" && unit.priceOverride != null;
      return <div key={unit.id ?? unit.unitName} className="border-t border-border-soft pt-2">
        <div className="mb-1 flex items-baseline justify-between gap-1 text-xs">
          <span className="font-semibold">{unit.unitName}</span>
          <span className="text-slate-500">{fixed ? "Giá riêng" : "Quy đổi"}</span>
        </div>
        <p className="mb-1 text-[11px] leading-4 text-slate-500">1 {unit.unitName} = {quantity(unit.multiplier)} {row.baseUnit}</p>
        {editable ? <AlternatePriceEditor row={row} book={book} retailId={retailId} unitName={unit.unitName} disabled={disabled} onCommit={onCommit} />
          : <span aria-label={`${book.name} / ${unit.unitName}`} className="block min-h-11 py-2 text-right text-sm tabular-nums"
            title={!readOnly ? "Không thể quy ngược khi giá chung hoặc giá riêng bằng 0. Hãy sửa giá đơn vị gốc." : undefined}>
            {pricingMoneyLabel(pricingUnitValue(row, book, retailId, unit.unitName))}
          </span>}
        <p className="h-4 text-[11px] leading-4 text-slate-500">{!editable && !readOnly ? `Sửa giá tại ${row.baseUnit}` : null}</p>
      </div>;
    })}
  </div>;
}
