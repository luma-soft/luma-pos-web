"use client";

import { useFieldArray, useFormContext, Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { Button, Select, TagInput } from "@/components/ui";
import { PRESET_ATTRIBUTES, type CreateProductInput } from "./schema";

export function AttributesField() {
  const t = useTranslations();
  const { control } = useFormContext<CreateProductInput>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "attributes",
  });

  const options = [
    ...PRESET_ATTRIBUTES.map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="text-sm text-slate-500">
          {t("products.attributes.empty")}
        </p>
      )}

      {fields.map((field, idx) => (
        <div
          key={field.id}
          className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto_auto] gap-2 items-start"
        >
          <Controller
            control={control}
            name={`attributes.${idx}.name`}
            render={({ field: f }) => (
              <Select
                value={f.value}
                onChange={f.onChange}
                onBlur={f.onBlur}
                placeholderTx="products.attributes.namePlaceholder"
                options={options}
              />
            )}
          />
          <Controller
            control={control}
            name={`attributes.${idx}.values`}
            render={({ field: f }) => (
              <TagInput
                value={f.value || []}
                onChange={f.onChange}
                placeholderTx="products.attributes.valuePlaceholder"
              />
            )}
          />
          <Controller
            control={control}
            name={`attributes.${idx}.createsVariants`}
            render={({ field: f }) => (
              <button
                type="button"
                onClick={() => f.onChange(!f.value)}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                  f.value
                    ? "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-300"
                    : "border-border bg-surface text-slate-500 hover:bg-surface-2"
                }`}
                title="Dùng thuộc tính này để tạo hàng hóa con"
              >
                <Boxes className="w-4 h-4" />
                SKU con
              </button>
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(idx)}
          >
            <Trash2 className="w-4 h-4 text-slate-400" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ name: "", values: [], createsVariants: false })}
      >
        <Plus className="w-4 h-4" />
        {t("products.attributes.add")}
      </Button>
    </div>
  );
}
