"use client";

import { useState } from "react";
import { MoneyInput } from "@/components/ui/money-input";
import { stopRowToggle } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { isPriceBookReadOnly, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { canEditPricingUnit, pricingUnitValue } from "./pricing-price-edit";
import type { PricingBook, PricingRow } from "./pricing-table";

export const pricingMoneyLabel = (value: number | null) => value == null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)} đ`;
const quantity = (value: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(value);

function AlternatePriceEditor({ row, book, retailId, unitName, disabled, onCommit, compactWidthClass, mobile = false }: {
  row: PricingRow; book: PricingBook; retailId: string; unitName: string; disabled: boolean;
  onCommit: (value: number | null, unitName: string) => void;
  compactWidthClass?: "w-28" | "w-32";
  mobile?: boolean;
}) {
  const value = pricingUnitValue(row, book, retailId, unitName);
  const [draft, setDraft] = useState<number | null>(value);
  const [previousRow, setPreviousRow] = useState(row);
  const [changed, setChanged] = useState(false);
  // Acknowledgement, cancellation and failed saves all supply a fresh row.
  if (previousRow !== row) { setPreviousRow(row); setDraft(value); setChanged(false); }
  const retail = systemPriceBookType(book) === "retail";
  return <div className={cn("relative min-w-0", mobile ? "w-full" : compactWidthClass ? cn("ml-auto", compactWidthClass) : "w-full")}>
    <MoneyInput decimals={2} value={draft ?? ""} disabled={disabled}
      aria-label={`${book.name} / ${unitName}`} placeholder={value == null ? "Chưa có giá" : undefined}
      title={retail ? "Để trống để trở lại giá quy đổi." : "Sửa giá này sẽ quy ngược về giá đơn vị gốc; chỉ xóa giá tại đơn vị gốc."}
      onChange={(next) => { setChanged(true); setDraft(next); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      onBlur={() => {
        if (!changed || draft === value || (draft == null && !retail)) { setDraft(value); setChanged(false); return; }
        setChanged(false);
        onCommit(draft, unitName);
      }}
      className={cn(
        "w-full border bg-surface text-right text-sm tabular-nums disabled:opacity-60",
        mobile ? "rounded-lg pl-2 pr-3" : "rounded-md py-1.5 pl-2 pr-2",
        "border-slate-200 dark:border-slate-700",
      )} />
  </div>;
}

/** Show unit prices in a stack or as one compact cell for a unit-specific row. */
export function PricingUnitEditors({ row, book, retailId, disabled = false, onCommit, unitName, compact = false, compactWidthClass, mobile = false }: {
  row: PricingRow; book: PricingBook; retailId: string; disabled?: boolean;
  onCommit: (value: number | null, unitName: string) => void;
  unitName?: string;
  compact?: boolean;
  compactWidthClass?: "w-28" | "w-32";
  mobile?: boolean;
}) {
  const units = (row.units ?? []).filter((unit) => unit.unitName !== row.baseUnit && (!unitName || unit.unitName === unitName));
  if (!units.length) return null;
  return <div className={compact ? "min-w-0 text-left" : "mt-2 space-y-2 text-left"} onClick={stopRowToggle}>
    {units.map((unit) => {
      const editable = canEditPricingUnit(row, book, retailId, unit.unitName);
      const readOnly = isPriceBookReadOnly(book);
      const value = pricingUnitValue(row, book, retailId, unit.unitName);
      if (compact) {
        return <div key={unit.id ?? unit.unitName} className="min-w-0">
          {editable ? <AlternatePriceEditor row={row} book={book} retailId={retailId} unitName={unit.unitName} disabled={disabled} onCommit={onCommit} compactWidthClass={compactWidthClass} mobile={mobile} />
            : <span aria-label={`${book.name} / ${unit.unitName}`} className="block min-h-11 py-2 text-right text-sm tabular-nums"
              title={!readOnly ? "Không thể quy ngược khi giá chung hoặc giá riêng bằng 0. Hãy sửa giá đơn vị gốc." : undefined}>
              {pricingMoneyLabel(value)}
            </span>}
          {value == null && <p className="mt-1 text-right text-[11px] leading-4 text-slate-500">Chưa có dữ liệu</p>}
          {!editable && !readOnly && <p className="text-right text-[11px] leading-4 text-slate-500">Sửa giá tại {row.baseUnit}</p>}
        </div>;
      }
      return <div key={unit.id ?? unit.unitName} className="border-t border-border-soft pt-2">
        <div className="mb-1 text-xs font-semibold">{unit.unitName}</div>
        <p className="mb-1 text-[11px] leading-4 text-slate-500">1 {unit.unitName} = {quantity(unit.multiplier)} {row.baseUnit}</p>
        {editable ? <AlternatePriceEditor row={row} book={book} retailId={retailId} unitName={unit.unitName} disabled={disabled} onCommit={onCommit} />
          : <span aria-label={`${book.name} / ${unit.unitName}`} className="block min-h-11 py-2 text-right text-sm tabular-nums"
            title={!readOnly ? "Không thể quy ngược khi giá chung hoặc giá riêng bằng 0. Hãy sửa giá đơn vị gốc." : undefined}>
            {pricingMoneyLabel(value)}
          </span>}
        <p className="h-4 text-[11px] leading-4 text-slate-500">{!editable && !readOnly ? `Sửa giá tại ${row.baseUnit}` : null}</p>
      </div>;
    })}
  </div>;
}
