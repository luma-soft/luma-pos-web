"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useForm,
  useFormContext,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ImagePlus,
  Info,
  Loader2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import {
  Form,
  FormField,
  Section,
  Input,
  NumberInput,
  Select,
  Button,
  Field,
  Heading,
  Textarea,
} from "@/components/ui";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  createProductSchema,
  type CreateProductInput,
  type CreateProductOutput,
} from "./schema";
import { MultiUnitField } from "./multi-unit-field";
import { AttributesField } from "./attributes-field";
import {
  createProduct,
  updateProduct,
  createCategory,
  createBrand,
} from "@/lib/actions/products";
import { Combobox } from "@/components/combobox";
import type { ProductFormOptions } from "@/lib/data/products";
import type { PriceBookRow } from "@/lib/data/price-books";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY } from "@/components/ai-assistant/utils";

type Tab = "info" | "description" | "variants";

const useFormCtx = () => useFormContext<CreateProductInput>();
const EMPTY_ATTRIBUTES: NonNullable<CreateProductInput["attributes"]> = [];
const EMPTY_VARIANT_CHILDREN: NonNullable<
  CreateProductInput["variantChildren"]
> = [];
const EMPTY_IMAGE_URLS: string[] = [];
const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

type AiWorkflowDraft = {
  intent?: string;
  action?: { payload?: Record<string, unknown> };
};

function specsWithOrderNote(
  specs: Record<string, string[]> | null,
  invoiceNote: string | undefined,
) {
  const note = invoiceNote?.trim();
  const next = { ...(specs ?? {}) };
  if (note) next[PRODUCT_ORDER_NOTE_SPEC_KEY] = [note];
  else delete next[PRODUCT_ORDER_NOTE_SPEC_KEY];
  return Object.keys(next).length > 0 ? next : null;
}

export interface NewProductFormProps {
  categories: ProductFormOptions["categories"];
  brands: ProductFormOptions["brands"];
  suppliers?: ProductFormOptions["suppliers"]; // NCC tự gắn khi nhập hàng, không sửa ở form
  priceBooks?: PriceBookRow[];
  mode?: "create" | "edit";
  productId?: string;
  isVariantChild?: boolean;
  siblingCount?: number;
  initialValues?: Partial<CreateProductInput>;
  layout?: "page" | "modal";
  closeHref?: string;
  aiPreview?: boolean;
}

export function NewProductForm({
  categories,
  brands,
  priceBooks = [],
  mode = "create",
  productId,
  isVariantChild = false,
  siblingCount = 0,
  initialValues,
  layout = "page",
  closeHref,
  aiPreview = false,
}: NewProductFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("info");
  const [submitIntent, setSubmitIntent] = useState<"save" | "sameType">("save");
  const isEdit = mode === "edit";
  const isModal = layout === "modal";
  const doneHref = closeHref ?? Routes.Products;

  const form = useForm<CreateProductInput, unknown, CreateProductOutput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      sku: "",
      barcode: "",
      name: "",
      categoryId: "",
      brandId: "",
      imageUrls: [],
      costPrice: 0,
      retailPrice: 0,
      priceBookPrices: {},
      initialStock: 0,
      minLevel: 0,
      maxLevel: 999_999_999,
      weightUnit: "kg",
      dimUnit: "mm",
      baseUnit: "cái",
      units: [],
      attributes: [],
      variantChildren: [],
      applyToSiblings: {
        enabled: false,
        fields: ["name", "imageUrls", "description"],
      },
      directSale: true,
      ...initialValues,
    },
  });

  useEffect(() => {
    if (!aiPreview) return;
    try {
      const raw = window.localStorage.getItem(AI_WORKFLOW_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as AiWorkflowDraft;
      const payload = draft.action?.payload ?? {};
      if (isEdit) {
        const draftProductId = typeof payload.productId === "string" ? payload.productId : null;
        if (draft.intent === "update_product_min_stock" && draftProductId === productId && typeof payload.minStock === "number") {
          form.setValue("minLevel", payload.minStock, { shouldDirty: true });
        }
        return;
      }
      if (draft.intent !== "create_product") return;
      const categoryId = typeof payload.categoryId === "string" && categories.some((category) => category.id === payload.categoryId)
        ? payload.categoryId
        : form.getValues("categoryId");
      form.reset({
        ...form.getValues(),
        name: typeof payload.name === "string" ? payload.name : form.getValues("name"),
        sku: typeof payload.sku === "string" ? payload.sku : form.getValues("sku"),
        categoryId,
        costPrice: typeof payload.costPrice === "number" ? payload.costPrice : form.getValues("costPrice"),
        retailPrice: typeof payload.retailPrice === "number" ? payload.retailPrice : form.getValues("retailPrice"),
        baseUnit: typeof payload.baseUnit === "string" ? payload.baseUnit : form.getValues("baseUnit"),
      });
    } catch {
      // Ignore stale or malformed AI drafts; the form remains usable.
    }
  }, [aiPreview, categories, form, isEdit, productId]);

  async function onSubmit(values: CreateProductOutput) {
    if (isEdit && productId) {
      const specs =
        values.attributes.length > 0
          ? Object.fromEntries(
              values.attributes
                .filter((a) => a.name.trim())
                .map((a) => [a.name, a.values]),
            )
          : null;
      const res = await updateProduct({
        id: productId,
        sku: values.sku?.trim() || "",
        barcode: values.barcode,
        name: values.name,
        categoryId: values.categoryId,
        brandId: values.brandId,
        baseUnit: values.baseUnit,
        costPrice: values.costPrice,
        retailPrice: values.retailPrice,
        wholesalePrice: values.wholesalePrice ?? null,
        contractorPrice: values.contractorPrice ?? null,
        agentPrice: values.agentPrice ?? null,
        priceBookPrices: values.priceBookPrices,
        location: values.location,
        description: values.description,
        imageUrls: values.imageUrls,
        isActive: values.directSale,
        specs: specsWithOrderNote(specs, values.invoiceNote),
        applyToSiblings: values.applyToSiblings,
        units: values.units.map((u) => ({
          unitName: u.unitName,
          multiplier: u.multiplier,
          barcode: u.barcode,
          priceOverride: u.priceOverride ?? null,
        })),
      });
      if (res.ok) {
        router.push(
          submitIntent === "sameType"
            ? sameTypeHref(productId)
            : isModal
              ? doneHref
              : Routes.product(productId),
        );
        router.refresh();
        return;
      }
      form.setError("root", { message: res.error });
      return;
    }
    const res = await createProduct(values);
    if (res.ok) {
      router.push(
        submitIntent === "sameType" ? sameTypeHref(res.data.id) : doneHref,
      );
      router.refresh();
      return;
    }
    form.setError("root", { message: res.error });
  }

  function sameTypeHref(id: string) {
    if (!isModal) return Routes.productSameType(id);
    const [path, query = ""] = doneHref.split("?");
    const sp = new URLSearchParams(query);
    sp.set("tab", "products");
    sp.set("productModal", "sameType");
    sp.set("sameTypeAs", id);
    return `${path || Routes.Inventory}?${sp.toString()}`;
  }

  const close = () => router.push(doneHref);

  return (
    <Form
      form={form}
      onSubmit={onSubmit}
      className={cn(
        "flex flex-col space-y-0",
        isModal
          ? "h-full bg-surface"
          : "min-h-dvh bg-slate-50 dark:bg-slate-950",
      )}
    >
      <header
        className={cn(
          "z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3",
          !isModal && "sticky top-0",
        )}
      >
        <div className="flex items-center gap-3">
          {!isModal && (
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={close}
              aria-label={t("common.back")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <Heading
            as="h1"
            size="lg"
            tx={isEdit ? "products.editTitle" : "products.create"}
          />
        </div>
        {isModal ? (
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            onClick={close}
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </Button>
        ) : (
          <FormActions
            loading={form.formState.isSubmitting}
            registerDirectSale={form.register("directSale")}
            onCancel={close}
            onIntent={setSubmitIntent}
          />
        )}
      </header>

      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6">
        <div className="flex gap-6 overflow-x-auto">
          {(["info", "variants", "description"] as Tab[]).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className={cn(
                "py-3 text-sm font-medium border-b-2 transition-colors",
                tab === tk
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400",
              )}
            >
              {t(`products.tabs.${tk}`)}
            </button>
          ))}
        </div>
      </div>

      {form.formState.errors.root && (
        <div className="bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900 px-4 sm:px-6 py-2 text-sm text-red-700 dark:text-red-400">
          {t(form.formState.errors.root.message ?? "errors.serverError")}
        </div>
      )}

      <div
        className={cn(
          "flex-1 overflow-auto p-4 sm:p-6 w-full space-y-4",
          isModal ? "mx-auto max-w-7xl" : "mx-auto max-w-5xl",
        )}
      >
        {tab === "info" && (
          <InfoTab
            categories={categories}
            brands={brands}
            priceBooks={priceBooks}
          />
        )}
        {tab === "variants" && (
          <VariantsTab
            isEdit={isEdit}
            isVariantChild={isVariantChild}
            siblingCount={siblingCount}
          />
        )}
        {tab === "description" && <DescriptionTab />}
      </div>

      {isModal && (
        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 sm:px-6">
          <FormActions
            loading={form.formState.isSubmitting}
            registerDirectSale={form.register("directSale")}
            onCancel={close}
            onIntent={setSubmitIntent}
            align="footer"
          />
        </footer>
      )}
    </Form>
  );
}

function FormActions({
  loading,
  registerDirectSale,
  onCancel,
  onIntent,
  align = "header",
}: {
  loading: boolean;
  registerDirectSale: UseFormRegisterReturn<"directSale">;
  onCancel: () => void;
  onIntent: (intent: "save" | "sameType") => void;
  align?: "header" | "footer";
}) {
  const t = useTranslations();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        align === "footer" && "justify-between",
      )}
    >
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          {...registerDirectSale}
          className="rounded text-primary-600 focus:ring-primary-500"
        />
        <span>{t("products.directSale")}</span>
      </label>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          tx="common.cancel"
        />
        <Button
          type="submit"
          variant="secondary"
          onClick={() => onIntent("sameType")}
          tx="products.saveAndCreateSameType"
        />
        <Button
          type="submit"
          loading={loading}
          onClick={() => onIntent("save")}
          tx="common.save"
        />
      </div>
    </div>
  );
}

function InfoTab({
  categories,
  brands,
  suppliers,
  priceBooks,
}: NewProductFormProps) {
  return (
    <>
      <BasicInfoSection
        categories={categories}
        brands={brands}
        suppliers={suppliers}
      />
      <Section
        titleTx="products.sections.pricing"
        descriptionTx="products.sections.pricingDesc"
      >
        <PricingFields priceBooks={priceBooks ?? []} />
      </Section>
      <Section
        titleTx="products.sections.stock"
        descriptionTx="products.sections.stockDesc"
      >
        <StockFields />
      </Section>
      <Section
        titleTx="products.sections.physical"
        descriptionTx="products.sections.physicalDesc"
      >
        <PhysicalFields />
      </Section>
    </>
  );
}

function DescriptionTab() {
  const { register } = useFormCtx();
  return (
    <div className="space-y-4">
      <Section titleTx="products.description.main" collapsible={false}>
        <Textarea {...register("description")} rows={8} />
      </Section>
      <Section titleTx="products.description.invoiceNote" collapsible={false}>
        <Textarea {...register("invoiceNote")} rows={4} />
      </Section>
    </div>
  );
}

function VariantsTab({
  isEdit,
  isVariantChild,
  siblingCount,
}: {
  isEdit: boolean;
  isVariantChild: boolean;
  siblingCount: number;
}) {
  return (
    <div className="space-y-4">
      <Section
        titleTx="products.sections.units"
        descriptionTx="products.sections.unitsDesc"
        collapsible={false}
      >
        <MultiUnitField />
      </Section>
      <Section
        titleTx="products.sections.attributes"
        descriptionTx="products.sections.attributesDesc"
        collapsible={false}
      >
        <AttributesField />
        {!isEdit && <VariantChildrenPreview />}
      </Section>
      {isEdit && isVariantChild && (
        <SiblingApplySection siblingCount={siblingCount} />
      )}
    </div>
  );
}

const APPLY_FIELD_OPTIONS = [
  "name",
  "imageUrls",
  "description",
  "category",
  "brand",
  "pricing",
  "units",
  "directSale",
  "attributes",
] as const;

function SiblingApplySection({ siblingCount }: { siblingCount: number }) {
  const t = useTranslations();
  const { register, watch } = useFormCtx();
  const enabled = Boolean(watch("applyToSiblings.enabled"));

  return (
    <Section title={t("products.variants.applyTitle")} collapsible={false}>
      <div className="space-y-3">
        <label className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <input
            type="checkbox"
            {...register("applyToSiblings.enabled")}
            className="mt-1 rounded text-primary-600 focus:ring-primary-500"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {t("products.variants.applyToSiblings", { count: siblingCount })}
              <Info className="h-4 w-4 text-slate-400" />
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              {t("products.variants.applyHint")}
            </span>
          </span>
        </label>

        {enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 rounded-xl border border-dashed border-border bg-slate-50 p-3 dark:bg-slate-900/40">
            {APPLY_FIELD_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  value={opt}
                  {...register("applyToSiblings.fields")}
                  className="rounded text-primary-600 focus:ring-primary-500"
                />
                <span>{t(`products.variants.applyFields.${opt}`)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function buildVariantCombinations(
  attributes: CreateProductInput["attributes"],
) {
  const grouped = new Map<string, Set<string>>();
  for (const attr of attributes ?? []) {
    const name = attr.name?.trim() ?? "";
    if (!name) continue;
    const values = (attr.values ?? [])
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const set = grouped.get(name) ?? new Set<string>();
    for (const value of values) set.add(value);
    grouped.set(name, set);
  }

  const usable = Array.from(grouped.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values),
  }));
  const valueCount = usable.reduce(
    (total, attr) => total + attr.values.length,
    0,
  );
  if (valueCount < 2) return [];

  const rows: Array<{ variantName: string; specs: Record<string, string[]> }> =
    [];
  const walk = (
    idx: number,
    picked: Array<{ name: string; value: string }>,
  ) => {
    if (idx === usable.length) {
      rows.push({
        variantName: picked.map((p) => p.value).join(" / "),
        specs: Object.fromEntries(picked.map((p) => [p.name, [p.value]])),
      });
      return;
    }
    for (const value of usable[idx].values)
      walk(idx + 1, [...picked, { name: usable[idx].name, value }]);
  };
  walk(0, []);
  return rows;
}

function VariantChildrenPreview() {
  const t = useTranslations();
  const { register, watch, setValue } = useFormCtx();
  const attributes = watch("attributes") ?? EMPTY_ATTRIBUTES;
  const children = watch("variantChildren") ?? EMPTY_VARIANT_CHILDREN;
  const parentName = watch("name") ?? "";
  const baseUnit = watch("baseUnit") ?? "cái";
  const costPrice = Number(watch("costPrice") ?? 0);
  const retailPrice = Number(watch("retailPrice") ?? 0);
  const wholesalePrice = watch("wholesalePrice") ?? null;
  const contractorPrice = watch("contractorPrice") ?? null;
  const agentPrice = watch("agentPrice") ?? null;
  const minLevel = Number(watch("minLevel") ?? 0);
  const imageUrls = watch("imageUrls") ?? EMPTY_IMAGE_URLS;

  const generated = useMemo(
    () => buildVariantCombinations(attributes),
    [attributes],
  );

  useEffect(() => {
    if (generated.length === 0) {
      if (children.length > 0)
        setValue("variantChildren", [], { shouldDirty: true });
      return;
    }
    const byName = new Map(children.map((child) => [child.variantName, child]));
    const next = generated.map((row) => {
      const current = byName.get(row.variantName);
      return {
        variantName: row.variantName,
        sku: current?.sku ?? "",
        barcode: current?.barcode ?? "",
        baseUnit: current?.baseUnit ?? baseUnit,
        costPrice: current?.costPrice ?? costPrice,
        retailPrice: current?.retailPrice ?? retailPrice,
        wholesalePrice: current?.wholesalePrice ?? wholesalePrice,
        contractorPrice: current?.contractorPrice ?? contractorPrice,
        agentPrice: current?.agentPrice ?? agentPrice,
        initialStock: current?.initialStock ?? 0,
        minLevel: current?.minLevel ?? minLevel,
        imageUrls: current?.imageUrls?.length ? current.imageUrls : imageUrls,
        directSale: current?.directSale ?? true,
        specs: row.specs,
      };
    });
    if (JSON.stringify(next) !== JSON.stringify(children)) {
      setValue("variantChildren", next, { shouldDirty: true });
    }
  }, [
    agentPrice,
    baseUnit,
    children,
    contractorPrice,
    costPrice,
    generated,
    imageUrls,
    minLevel,
    retailPrice,
    setValue,
    wholesalePrice,
  ]);

  if (generated.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-2 text-sm text-slate-500">
        {t("products.variants.childHint")}
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-semibold">
            {t("products.variants.childTitle")}
          </div>
          <div className="text-xs text-slate-500">
            {t("products.variants.childCount", {
              count: children.length,
              name: parentName || t("products.variants.parentFallback"),
            })}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60">
            <tr>
              <th className="px-3 py-2 font-semibold">
                {t("products.variants.variant")}
              </th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">
                {t("products.fields.barcode")}
              </th>
              <th className="px-3 py-2 font-semibold">{t("pos.unit")}</th>
              <th className="px-3 py-2 font-semibold text-right">
                {t("products.pricing.costPrice")}
              </th>
              <th className="px-3 py-2 font-semibold text-right">
                {t("products.pricing.retailPrice")}
              </th>
              <th className="px-3 py-2 font-semibold text-right">
                {t("products.variants.initialStock")}
              </th>
              <th className="px-3 py-2 font-semibold text-center">
                {t("products.variants.sale")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {children.map((child, idx) => (
              <tr key={child.variantName}>
                <td className="px-3 py-2">
                  <input
                    type="hidden"
                    {...register(`variantChildren.${idx}.variantName`)}
                  />
                  <div className="font-medium">{child.variantName}</div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    {...register(`variantChildren.${idx}.sku`)}
                    placeholder={t("products.variants.autoSku")}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input {...register(`variantChildren.${idx}.barcode`)} />
                </td>
                <td className="px-3 py-2">
                  <Input {...register(`variantChildren.${idx}.baseUnit`)} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    {...register(`variantChildren.${idx}.costPrice`, {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    {...register(`variantChildren.${idx}.retailPrice`, {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    {...register(`variantChildren.${idx}.initialStock`, {
                      valueAsNumber: true,
                    })}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    {...register(`variantChildren.${idx}.directSale`)}
                    className="rounded text-primary-600 focus:ring-primary-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BasicInfoSection({ categories, brands }: NewProductFormProps) {
  const t = useTranslations();
  const { register, watch, setValue } = useFormCtx();
  const [extraCats, setExtraCats] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [extraBrands, setExtraBrands] = useState<
    { id: string; name: string }[]
  >([]);

  return (
    <Section title="" collapsible={false}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field labelTx="products.fields.sku">
              <Input
                {...register("sku")}
                placeholderTx="products.fields.skuPlaceholder"
              />
            </Field>
            <Field labelTx="products.fields.barcode">
              <Input
                {...register("barcode")}
                placeholderTx="products.fields.barcodePlaceholder"
              />
            </Field>
          </div>

          <FormField name="name" labelTx="products.fields.name" required>
            {(field) => (
              <Input
                {...field}
                placeholderTx="products.fields.namePlaceholder"
              />
            )}
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="categoryId"
              labelTx="products.fields.category"
              required
            >
              {(field) => (
                <Combobox
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  allowClear={false}
                  placeholder={t("products.fields.categoryPlaceholder")}
                  options={[...categories, ...extraCats].map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  onCreate={async (name) => {
                    const r = await createCategory(name);
                    if (r.ok) {
                      setExtraCats((x) => [...x, r.data]);
                      return r.data.id;
                    }
                    return null;
                  }}
                />
              )}
            </FormField>
            <Field labelTx="products.fields.brand">
              <Combobox
                value={watch("brandId") ?? ""}
                onChange={(v) => setValue("brandId", v)}
                placeholder={t("products.fields.brandPlaceholder")}
                options={[...brands, ...extraBrands].map((b) => ({
                  value: b.id,
                  label: b.name,
                }))}
                onCreate={async (name) => {
                  const r = await createBrand(name);
                  if (r.ok) {
                    setExtraBrands((x) => [...x, r.data]);
                    return r.data.id;
                  }
                  return null;
                }}
              />
            </Field>
          </div>
        </div>

        <ImageUploadGrid />
      </div>
    </Section>
  );
}

const MAX_IMAGES = 5;

/** Tên file ngẫu nhiên cho ảnh upload (ngoài render scope — tránh lint react-compiler). */
function randomImagePath(fileName: string): string {
  const ext = fileName.split(".").pop() || "jpg";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

function ImageUploadGrid() {
  const t = useTranslations();
  const { watch, setValue } = useFormCtx();
  const urls: string[] = watch("imageUrls") ?? [];
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [urlInput, setUrlInput] = useState("");

  function addImageUrl() {
    const value = urlInput.trim();
    setErr("");
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      if (urls.includes(value)) {
        setUrlInput("");
        return;
      }
      setValue("imageUrls", [...urls, value], { shouldDirty: true });
      setUrlInput("");
    } catch {
      setErr(t("products.fields.imageUrlInvalid"));
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr("");
    setUploading(true);
    try {
      const supabase = createClient();
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, MAX_IMAGES - urls.length)) {
        const path = randomImagePath(file.name);
        const { error } = await supabase.storage
          .from("products")
          .upload(path, file, { upsert: false });
        if (error) throw error;
        const { data } = supabase.storage.from("products").getPublicUrl(path);
        added.push(data.publicUrl);
      }
      setValue("imageUrls", [...urls, ...added], { shouldDirty: true });
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : t("products.fields.imageUploadError"),
      );
    } finally {
      setUploading(false);
    }
  }

  const remove = (u: string) =>
    setValue(
      "imageUrls",
      urls.filter((x) => x !== u),
      { shouldDirty: true },
    );

  return (
    <div>
      {urls.length < MAX_IMAGES && (
        <div className="mb-3 flex gap-2">
          <Input
            type="url"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addImageUrl();
              }
            }}
            placeholder={t("products.fields.imageUrlPlaceholder")}
            aria-label={t("products.fields.imageUrl")}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addImageUrl}
            disabled={!urlInput.trim()}
          >
            {t("products.fields.addImageUrl")}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {urls.map((u, i) => (
          <div
            key={u}
            className={cn(
              "relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 group",
              i === 0 && "col-span-2",
            )}
          >
            <Image
              src={u}
              alt=""
              fill
              sizes="240px"
              className="object-cover"
              unoptimized
            />
            {i === 0 && (
              <span className="absolute top-1 left-1 bg-primary-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                {t("products.fields.primaryImage")}
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(u)}
              className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 transition"
              aria-label={t("common.delete")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {urls.length < MAX_IMAGES && (
          <label
            className={cn(
              "aspect-square border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg flex flex-col items-center justify-center gap-1 bg-slate-50 dark:bg-slate-800/50 cursor-pointer hover:border-primary-500 transition text-slate-400",
              urls.length === 0 && "col-span-2",
            )}
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <ImagePlus className="w-6 h-6" />
            )}
            <span className="text-xs">{t("products.fields.addImage")}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              onChange={(e) => {
                upload(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>
        )}
      </div>
      {err ? (
        <p className="text-xs text-red-600 mt-2">{err}</p>
      ) : (
        <p className="text-xs text-slate-500 mt-2">
          {t("products.fields.imageHint")}
        </p>
      )}
    </div>
  );
}

function PricingFields({ priceBooks }: { priceBooks: PriceBookRow[] }) {
  const t = useTranslations();
  const { setValue, watch } = useFormCtx();
  const retailPrice = Number(watch("retailPrice") ?? 0);
  const priceBookPrices = watch("priceBookPrices") ?? {};
  const [open, setOpen] = useState(false);
  const [draftRetail, setDraftRetail] = useState(retailPrice);
  const [draftOverrides, setDraftOverrides] =
    useState<Record<string, number | null>>(priceBookPrices);

  function openPriceBooks() {
    setDraftRetail(Number(watch("retailPrice") ?? 0));
    setDraftOverrides({ ...(watch("priceBookPrices") ?? {}) });
    setOpen(true);
  }

  function applyPriceBooks() {
    setValue("retailPrice", draftRetail, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("priceBookPrices", draftOverrides, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setOpen(false);
  }

  const activeBooks =
    priceBooks.length > 0
      ? priceBooks
      : [
          {
            id: "retail",
            name: t("products.pricing.retailPrice"),
            isDefault: true,
            sortOrder: 0,
          },
        ];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] lg:grid-cols-[1fr_1fr_auto] gap-4 items-end">
        <Field labelTx="products.pricing.costPrice">
          <NumberInput
            value={watch("costPrice")}
            onChange={(v) => setValue("costPrice", v ?? 0)}
            suffix="đ"
            min={0}
          />
        </Field>
        <Field labelTx="products.pricing.retailPrice">
          <NumberInput
            value={watch("retailPrice")}
            onChange={(v) => setValue("retailPrice", v ?? 0)}
            suffix="đ"
            min={0}
          />
        </Field>
        <button
          type="button"
          onClick={openPriceBooks}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/30"
        >
          <Tag className="h-4 w-4" />
          {t("products.pricing.setupPriceBooks")}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 sm:p-6">
          <div className="flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
            <header className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {t("products.pricing.choosePriceBooks")}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t("products.pricing.activeBookCount", {
                    count: activeBooks.length,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-surface-2"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 sm:px-6">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                    <th className="px-4 py-3 font-semibold">
                      {t("pricing.cols.name")}
                    </th>
                    <th className="px-4 py-3 text-right font-semibold">
                      {t("products.pricing.retailPrice")}
                    </th>
                    <th className="w-12 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {activeBooks.map((book) => {
                    const value = book.isDefault
                      ? draftRetail
                      : (draftOverrides[book.id] ?? null);
                    return (
                      <tr key={book.id}>
                        <td className="px-4 py-3 font-medium">{book.name}</td>
                        <td className="px-4 py-3">
                          <NumberInput
                            value={value}
                            onChange={(next) => {
                              if (book.isDefault) setDraftRetail(next ?? 0);
                              else
                                setDraftOverrides((current) => ({
                                  ...current,
                                  [book.id]: next,
                                }));
                            }}
                            suffix="đ"
                            min={0}
                            className="ml-auto max-w-[260px]"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!book.isDefault && (
                            <button
                              type="button"
                              onClick={() =>
                                setDraftOverrides((current) => ({
                                  ...current,
                                  [book.id]: null,
                                }))
                              }
                              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-er"
                              aria-label={t("common.clear")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="flex justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                tx="common.cancel"
              />
              <Button
                type="button"
                onClick={applyPriceBooks}
                tx="common.done"
              />
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function StockFields() {
  const { setValue, watch } = useFormCtx();
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field labelTx="products.stock.current">
        <NumberInput
          value={watch("initialStock")}
          onChange={(v) => setValue("initialStock", v ?? 0)}
          min={0}
        />
      </Field>
      <Field labelTx="products.stock.min">
        <NumberInput
          value={watch("minLevel")}
          onChange={(v) => setValue("minLevel", v ?? 0)}
          min={0}
        />
      </Field>
      <Field labelTx="products.stock.max">
        <NumberInput
          value={watch("maxLevel")}
          onChange={(v) => setValue("maxLevel", v ?? 999_999_999)}
          min={0}
        />
      </Field>
    </div>
  );
}

function PhysicalFields() {
  const t = useTranslations();
  const { register, setValue, watch } = useFormCtx();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field labelTx="products.physical.location">
          <Input
            {...register("location")}
            placeholderTx="products.physical.locationPlaceholder"
          />
        </Field>
        <Field labelTx="products.physical.weight">
          <div className="flex gap-2">
            <NumberInput
              value={watch("weight") ?? null}
              onChange={(v) => setValue("weight", v)}
              min={0}
              decimals={3}
              className="flex-1"
            />
            <Select
              {...register("weightUnit")}
              className="w-20"
              options={[
                { value: "g", label: "g" },
                { value: "kg", label: "kg" },
              ]}
            />
          </div>
        </Field>
      </div>

      <Field labelTx="products.physical.dimensions">
        <div className="grid grid-cols-4 gap-2">
          <NumberInput
            value={watch("width") ?? null}
            onChange={(v) => setValue("width", v)}
            placeholder={t("products.physical.width")}
            min={0}
          />
          <NumberInput
            value={watch("length") ?? null}
            onChange={(v) => setValue("length", v)}
            placeholder={t("products.physical.length")}
            min={0}
          />
          <NumberInput
            value={watch("thickness") ?? null}
            onChange={(v) => setValue("thickness", v)}
            placeholder={t("products.physical.thickness")}
            min={0}
          />
          <Select
            {...register("dimUnit")}
            options={[
              { value: "mm", label: "mm" },
              { value: "cm", label: "cm" },
              { value: "m", label: "m" },
            ]}
          />
        </div>
      </Field>
    </div>
  );
}
