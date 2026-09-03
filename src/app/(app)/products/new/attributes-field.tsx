"use client";

import { useCallback, useEffect, useState } from "react";
import { useFieldArray, useFormContext, Controller, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import type { CreateProductInput } from "./schema";
import { buildAttributeNameOptions } from "./attribute-name-options";
import { getProductAttributes } from "@/lib/actions/product-attributes";
import { findCatalogAttribute, type ProductAttribute } from "@/lib/products/attribute-catalog";
import { AttributeCatalogDialog } from "./attribute-catalog-dialog";
import type { ActionResult } from "@/lib/actions/common";
import { VariantValuesInput } from "./variant-values-input";
import { variantCombinationKey } from "@/lib/products/variant-model";

const CREATE_ATTRIBUTE = "__create_attribute__";

export function AttributesField({ locked = false }: { locked?: boolean }) {
  const t = useTranslations();
  const { control, getValues, setValue } = useFormContext<CreateProductInput>();
  const [catalog, setCatalog] = useState<ProductAttribute[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ create: boolean; row?: number } | null>(null);
  const currentAttributes = useWatch({ control, name: "attributes" }) ?? [];
  const children = useWatch({ control, name: "variantChildren" }) ?? [];
  const protectedIds = new Set(children.filter((child) => child.productId).flatMap((child) => child.optionValueIds ?? []));
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "attributes",
  });

  const acceptCatalog = useCallback((result: ActionResult<ProductAttribute[]>) => {
    if (!result.ok) { setError(result.error); return; }
    setCatalog(result.data);
    setError("");
    setLoaded(true);
    // Resolve old names from an open draft without replacing rows/values.
    (getValues("attributes") ?? []).forEach((attribute, index) => {
      const canonical = result.data.find((item) => item.id === attribute.attributeId)
        ?? findCatalogAttribute(result.data, attribute.name);
      if (canonical) {
        if (canonical.name !== attribute.name) setValue(`attributes.${index}.name`, canonical.name, { shouldDirty: true });
        if (!attribute.attributeId || attribute.attributeId.startsWith("attribute:")) {
          const oldId = attribute.attributeId;
          setValue(`attributes.${index}.attributeId`, canonical.id);
          if (oldId && oldId !== canonical.id) {
            const remap = (key: string) => {
              const selections = JSON.parse(key) as [string, string][];
              return variantCombinationKey(selections.map(([id, value]) => [id === oldId ? canonical.id : id, value]));
            };
            setValue("variantChildren", (getValues("variantChildren") ?? []).map((child) => {
              if (!child.combinationKey) return child;
              const combinationKey = remap(child.combinationKey);
              return { ...child, combinationKey, optionValueIds: (JSON.parse(combinationKey) as [string, string][]).map((pair) => pair[1]) };
            }));
            setValue("excludedCombinationKeys", (getValues("excludedCombinationKeys") ?? []).map(remap));
          }
        }
      }
    });
  }, [getValues, setValue]);

  const refresh = useCallback(async () => {
    try { acceptCatalog(await getProductAttributes()); }
    catch { setError("products.attributes.failed"); }
  }, [acceptCatalog]);

  useEffect(() => {
    let active = true;
    getProductAttributes().then((result) => { if (active) acceptCatalog(result); })
      .catch(() => { if (active) setError("products.attributes.failed"); });
    return () => { active = false; };
  }, [acceptCatalog]);

  const draftAttributeIds = new Set(currentAttributes.flatMap((attribute) => {
    const item = findCatalogAttribute(catalog, attribute.name);
    return item ? [item.id] : [];
  }));

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="text-sm text-slate-500">
          Chưa có thuộc tính tạo biến thể. Thêm phiên bản, màu hoặc dung tích để tạo hàng cùng loại.
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
                onValueChange={(value) => {
                  if (value === CREATE_ATTRIBUTE) setDialog({ create: true, row: idx });
                  else {
                    f.onChange(value);
                    const item = findCatalogAttribute(catalog, value);
                    setValue(`attributes.${idx}.attributeId`, item?.id ?? crypto.randomUUID(), { shouldDirty: true });
                    setValue(`attributes.${idx}.createsVariants`, true);
                  }
                }}
                onBlur={f.onBlur}
                ref={f.ref}
                aria-label={t("products.attributes.nameLabel")}
                disabled={!loaded || locked || (currentAttributes[idx]?.valueIds ?? []).some((id) => protectedIds.has(id))}
                menuMinWidth={260}
                placeholderTx="products.attributes.namePlaceholder"
                options={[
                  { value: CREATE_ATTRIBUTE, label: `+ ${t("products.attributes.create")}` },
                  ...buildAttributeNameOptions(catalog, f.value).filter((option) =>
                    option.value === f.value || !currentAttributes.some((attribute) => attribute.name === option.value)),
                ]}
              />
            )}
          />
          <Controller
            control={control}
            name={`attributes.${idx}.values`}
            render={({ field: f }) => (
              <VariantValuesInput
                values={f.value || []}
                valueIds={currentAttributes[idx]?.valueIds ?? []}
                onChange={(values, ids) => {
                  setValue(`attributes.${idx}.valueIds`, ids, { shouldDirty: true });
                  setValue(`attributes.${idx}.createsVariants`, true);
                  f.onChange(values);
                }}
                protectedIds={protectedIds}
                disabled={locked}
                label={`${currentAttributes[idx]?.name || t("products.attributes.nameLabel")} — Giá trị`}
              />
            )}
          />
          <div className="flex items-center justify-end">
          <Button type="button" variant="ghost" size="icon" disabled={locked || idx === 0} onClick={() => move(idx, idx - 1)} aria-label="Đưa thuộc tính lên"><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" disabled={locked || idx === fields.length - 1} onClick={() => move(idx, idx + 1)} aria-label="Đưa thuộc tính xuống"><ArrowDown className="h-4 w-4" /></Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(idx)}
            disabled={locked || (currentAttributes[idx]?.valueIds ?? []).some((id) => protectedIds.has(id))}
            aria-label={t("products.attributes.removeFromProduct")}
            className="min-h-11 min-w-11 justify-self-end lg:min-h-0 lg:min-w-0"
          >
            <Trash2 className="w-4 h-4 text-slate-400" />
          </Button>
          </div>
        </div>
      ))}

      {error && <div role="alert" className="flex items-center gap-2 text-sm text-red-600">{t(error)}<Button type="button" variant="ghost" onClick={() => void refresh()}>{t("products.attributes.retry")}</Button></div>}
      <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={locked || children.some((child) => child.productId && child.combinationKey)}
        onClick={() => append({ attributeId: crypto.randomUUID(), name: "", values: [], valueIds: [], createsVariants: true })}
      >
        <Plus className="w-4 h-4" />
        {t("products.attributes.add")}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={!loaded} onClick={() => setDialog({ create: false })}>
        <Settings2 className="h-4 w-4" />{t("products.attributes.manage")}
      </Button>
      </div>
      {dialog && <AttributeCatalogDialog attributes={catalog} create={dialog.create} draftAttributeIds={draftAttributeIds}
        onClose={() => setDialog(null)} onChanged={refresh}
        onCreated={(name, attributeId) => {
          if (dialog.row !== undefined) {
            setValue(`attributes.${dialog.row}.name`, name, { shouldDirty: true, shouldValidate: true });
            setValue(`attributes.${dialog.row}.attributeId`, attributeId, { shouldDirty: true });
            setValue(`attributes.${dialog.row}.createsVariants`, true);
          }
        }} />}
    </div>
  );
}
