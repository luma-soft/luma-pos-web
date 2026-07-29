"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { cn, formatCurrency } from "@/lib/utils";

interface OrderEditLine {
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
}

interface OrderEditLineLabels {
  unit: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  delete: string;
}

export function OrderEditMobileLineLayout({
  productName,
  unitName,
  labels,
  quantityControl,
  unitPriceControl,
  lineTotal,
  onDelete,
}: {
  productName: string;
  unitName: string;
  labels: OrderEditLineLabels;
  quantityControl: ReactNode;
  unitPriceControl: ReactNode;
  lineTotal: string;
  onDelete: () => void;
}) {
  return (
    <article className="space-y-3 rounded-xl border border-border-soft p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{productName}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {labels.unit}: {unitName}
          </p>
        </div>
        <button
          type="button"
          aria-label={labels.delete}
          onClick={onDelete}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[132px_minmax(0,1fr)]">
        <label className="space-y-1 text-xs font-medium text-slate-500">
          <span className="block">{labels.quantity}</span>
          {quantityControl}
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium text-slate-500">
          <span className="block">{labels.unitPrice}</span>
          {unitPriceControl}
        </label>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3 text-sm">
        <span className="text-slate-500">{labels.lineTotal}</span>
        <span className="tabular-nums font-semibold">{lineTotal}</span>
      </div>
    </article>
  );
}

export function OrderEditMobileLine({
  line,
  labels,
  inputClassName,
  onQuantityChange,
  onUnitPriceChange,
  onDelete,
}: {
  line: OrderEditLine;
  labels: OrderEditLineLabels;
  inputClassName: string;
  onQuantityChange: (quantity: number) => void;
  onUnitPriceChange: (unitPrice: number) => void;
  onDelete: () => void;
}) {
  return (
    <OrderEditMobileLineLayout
      productName={line.productName}
      unitName={line.unitName}
      labels={labels}
      quantityControl={
        <QuantityInput
            min={0}
            value={line.quantity}
            onChange={onQuantityChange}
            size="sm"
            className="w-[132px]"
        />
      }
      unitPriceControl={
        <MoneyInput
            value={line.unitPrice}
            onChange={(value) => onUnitPriceChange(value ?? 0)}
            className={cn(
              inputClassName,
              "w-full text-right min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
            )}
        />
      }
      lineTotal={formatCurrency(line.quantity * line.unitPrice)}
      onDelete={onDelete}
    />
  );
}
