"use client";

import { useFieldArray, useFormContext, Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
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
          className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-start"
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
        onClick={() => append({ name: "", values: [] })}
      >
        <Plus className="w-4 h-4" />
        {t("products.attributes.add")}
      </Button>
    </div>
  );
}
