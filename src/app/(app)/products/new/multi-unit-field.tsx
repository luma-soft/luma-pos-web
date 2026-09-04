"use client";

import { useFieldArray, useFormContext } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, NumberInput, Field } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import type { CreateProductInput } from "./schema";

export function MultiUnitField() {
  const t = useTranslations();
  const { control, register, watch, setValue } =
    useFormContext<CreateProductInput>();
  const baseUnit = watch("baseUnit") || "cái";
  const retailPrice = watch("retailPrice") ?? 0;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "units",
    keyName: "fieldKey",
  });

  return (
    <div className="space-y-3">
      <Field labelTx="products.units.baseUnit" required>
        <Input
          {...register("baseUnit")}
          placeholderTx="products.units.baseUnitPlaceholder"
          className="max-w-xs"
        />
      </Field>

      {fields.length > 0 && (
        <div className="space-y-2">
          {fields.map((field, idx) => (
            <div
              key={field.fieldKey}
              className="grid grid-cols-1 md:grid-cols-[1fr_140px_1fr_1fr_auto] gap-2 items-start p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
            >
              <Field labelTx="products.units.unitName" className="min-w-0">
                <Input
                  {...register(`units.${idx}.unitName`)}
                  placeholderTx="products.units.unitNamePlaceholder"
                />
              </Field>

              <Field
                labelTx="products.units.multiplier"
                className="min-w-0"
                hint={t("products.units.multiplierHint", {
                  unit: watch(`units.${idx}.unitName`) || "?",
                  count: new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 4 }).format(watch(`units.${idx}.multiplier`) || 1),
                  base: baseUnit,
                })}
              >
                <NumberInput
                  value={watch(`units.${idx}.multiplier`)}
                  onChange={(v) => setValue(`units.${idx}.multiplier`, v ?? 1)}
                  min={0}
                  decimals={4}
                  aria-label={`Hệ số quy đổi ${watch(`units.${idx}.unitName`) || "đơn vị"}`}
                />
              </Field>

              <Field labelTx="products.units.barcode" className="min-w-0">
                <Input
                  {...register(`units.${idx}.barcode`)}
                  placeholderTx="products.fields.barcodePlaceholder"
                />
              </Field>

              <Field labelTx="products.units.priceOverride" className="min-w-0">
                <NumberInput
                  value={watch(`units.${idx}.priceOverride`) ?? null}
                  onChange={(v) => setValue(`units.${idx}.priceOverride`, v)}
                  suffix={`đ/${watch(`units.${idx}.unitName`) || "đơn vị"}`}
                  decimals={2}
                  aria-label={`Giá riêng mỗi ${watch(`units.${idx}.unitName`) || "đơn vị"}`}
                  placeholder={formatNumber(Math.round(retailPrice * (watch(`units.${idx}.multiplier`) || 1)))}
                  min={0}
                />
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {watch(`units.${idx}.priceOverride`) == null
                    ? `Quy đổi: ${formatNumber(Math.round(retailPrice * (watch(`units.${idx}.multiplier`) || 1)))} đ/${watch(`units.${idx}.unitName`) || "đơn vị"}`
                    : "Giá riêng · Không tự đổi theo giá gốc"}
                </p>
                <p className="text-xs leading-5 text-slate-500">Để trống để dùng giá quy đổi.</p>
              </Field>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(idx)}
                aria-label={t("common.delete")}
                className="h-10 min-h-11 min-w-11 justify-self-end md:mt-[26px] md:self-start lg:min-h-0 lg:min-w-0"
              >
                <Trash2 className="w-4 h-4 text-slate-400" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          append({
            unitName: "",
            multiplier: 1,
            barcode: "",
            priceOverride: null,
          })
        }
      >
        <Plus className="w-4 h-4" />
        {t("products.units.addUnit")}
      </Button>
    </div>
  );
}
