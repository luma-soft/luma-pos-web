"use client";

import { isPriceBookReadOnly } from "@/lib/pricing/system-price-books";

import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  Link2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  Form,
  FormField,
  Section,
  Input,
  NumberInput,
  QuantityInput,
  Select,
  Button,
  Field,
  Heading,
  Textarea,
} from "@/components/ui";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  createProductSchema,
  type CreateProductInput,
  type CreateProductOutput,
} from "./schema";
import { MultiUnitField } from "./multi-unit-field";
import { AttributesField } from "./attributes-field";
import { VariantChildrenField } from "./variant-children-field";
import { normalizeVariantAttributes } from "@/lib/products/variant-model";
import { saveProductVariantGroup } from "@/lib/actions/product-variants";
import {
  createProduct,
  updateProduct,
  updateProductStock,
  createCategory,
  createBrand,
} from "@/lib/actions/products";
import { Combobox } from "@/components/combobox";
import type { ProductDetail, ProductFormOptions } from "@/lib/data/products";
import type { PriceBookRow } from "@/lib/data/price-books";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY, tenantStorageKey } from "@/components/ai-assistant/utils";
import { useTenantClientScope } from "@/components/tenant-client-scope";
import { changedProductStock } from "@/lib/products/stock-adjustment";
import {
  PRODUCT_IMAGE_ACCEPT,
  deleteUploadedProductImage,
  managedImageToDeleteImmediately,
  uploadProductImageFiles,
  type ProductImageUploadDraft,
  type UploadedProductImage,
} from "@/lib/images/product-image-upload";

type Tab = "info" | "description" | "variants";

const useFormCtx = () => useFormContext<CreateProductInput>();
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
  storeId: string;
  publicMediaBaseUrl: string;
  categories: ProductFormOptions["categories"];
  brands: ProductFormOptions["brands"];
  suppliers?: ProductFormOptions["suppliers"]; // NCC tự gắn khi nhập hàng, không sửa ở form
  comboProducts?: ProductFormOptions["comboProducts"];
  priceBooks?: PriceBookRow[];
  mode?: "create" | "edit";
  productId?: string;
  isVariantChild?: boolean;
  siblingCount?: number;
  initialValues?: Partial<CreateProductInput>;
  variantGroup?: ProductDetail["variantGroup"];
  initialManagedImages?: UploadedProductImage[];
  layout?: "page" | "modal";
  closeHref?: string;
  closeNavigation?: "push" | "replace";
  aiPreview?: boolean;
  creationKind?: "product" | "service" | "combo";
}

export function NewProductForm({
  categories,
  brands,
  storeId,
  publicMediaBaseUrl,
  comboProducts = [],
  priceBooks = [],
  mode = "create",
  productId,
  isVariantChild = false,
  siblingCount = 0,
  initialValues,
  variantGroup,
  initialManagedImages = [],
  layout = "page",
  closeHref,
  closeNavigation = "push",
  aiPreview = false,
  creationKind = "product",
}: NewProductFormProps) {
  const storageScope = useTenantClientScope();
  const t = useTranslations();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialValues?.variantOperation === "add" ? "variants" : "info");
  const [submitIntent, setSubmitIntent] = useState<"save" | "sameType">("save");
  const isEdit = mode === "edit";
  const isModal = layout === "modal";
  const doneHref = closeHref ?? Routes.Products;
  const navigateAfterModal = (href: string) => {
    if (closeNavigation === "replace") router.replace(href);
    else router.push(href);
  };

  const [requestId] = useState(() => crypto.randomUUID());
  const preparedAttributes = useMemo(() => {
    const attributes = initialValues?.attributes ?? [];
    // Normal SKU editing keeps its selected values. Group/create uses stable axes.
    if (isEdit && !initialValues?.variantGroupId) return attributes;
    try {
      return [...attributes.filter((attribute) => attribute.createsVariants === false), ...normalizeVariantAttributes(attributes.map((attribute) => ({ ...attribute, values: attribute.values ?? [] })))];
    } catch {
      return attributes;
    }
  }, [initialValues, isEdit]);
  const form = useForm<CreateProductInput, unknown, CreateProductOutput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      sku: "",
      productKind: creationKind,
      barcode: "",
      name: "",
      categoryId: "",
      brandId: "",
      imageUrls: [],
      imageMediaIds: [],
      costPrice: 0,
      retailPrice: 0,
      initialStock: 0,
      minLevel: 0,
      maxLevel: 999_999_999,
      weightUnit: "kg",
      dimUnit: "mm",
      baseUnit: creationKind === "combo" ? "combo" : "cái",
      units: [],
      variantContractVersion: 2,
      variantOperation: "create",
      excludedCombinationKeys: [],
      requestId,
      variantChildren: [],
      comboItems: [],
      applyToSiblings: {
        enabled: false,
        fields: ["name", "imageUrls"],
      },
      directSale: true,
      ...initialValues,
      priceBookPrices: Object.fromEntries(Object.entries(initialValues?.priceBookPrices ?? {}).filter(([id]) => priceBooks.some((book) => book.id === id && !book.isDefault && !isPriceBookReadOnly(book)))),
      attributes: preparedAttributes,
    },
  });

  useEffect(() => {
    if (!aiPreview) return;
    try {
      const raw = window.localStorage.getItem(tenantStorageKey(AI_WORKFLOW_DRAFT_STORAGE_KEY, storageScope));
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
  }, [aiPreview, categories, form, isEdit, productId, storageScope]);

  async function onSubmit(values: CreateProductOutput) {
    if (values.variantGroupId || values.variantChildren.length > 0) {
      const result = await saveProductVariantGroup(values);
      if (!result.ok) { form.setError("root", { message: result.error }); return; }
      navigateAfterModal(submitIntent === "sameType" ? sameTypeHref(result.data.id) : isModal ? doneHref : Routes.product(result.data.id));
      router.refresh();
      return;
    }
    if (isEdit && productId) {
      const defaults = createProductSchema.safeParse(form.formState.defaultValues);
      const stockAdjustment = changedProductStock(
        values.currentStock, form.formState.defaultValues?.currentStock,
      );
      // Compare every parsed field, not dirtyFields (programmatic edits may not
      // mark dirty). Any metadata/image/unit edit keeps the full save path.
      const stockOnly = stockAdjustment && defaults.success &&
        !values.applyToSiblings.enabled &&
        JSON.stringify({ ...values, currentStock: undefined }) ===
          JSON.stringify({ ...defaults.data, currentStock: undefined });
      const specs =
        values.attributes.length > 0
          ? Object.fromEntries(
              values.attributes
                .filter((a) => a.name.trim())
                .map((a) => [a.name, a.values]),
            )
          : null;
      const res = stockOnly
        ? await updateProductStock({ id: productId, stockAdjustment })
        : await updateProduct({
          id: productId,
          productKind: values.productKind,
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
          imageMediaIds: values.imageMediaIds,
          comboItems: values.comboItems,
          isActive: values.directSale,
          specs: specsWithOrderNote(specs, values.invoiceNote),
          applyToSiblings: values.applyToSiblings,
          units: values.units,
          stockAdjustment,
        });
      if (res.ok) {
        const href =
          submitIntent === "sameType"
            ? sameTypeHref(productId)
            : isModal
              ? doneHref
              : Routes.product(productId);
        if (isModal) navigateAfterModal(href);
        else router.push(href);
        router.refresh();
        return;
      }
      form.setError("root", { message: res.error });
      return;
    }
    const res = await createProduct(values);
    if (res.ok) {
      navigateAfterModal(
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

  const close = () => navigateAfterModal(doneHref);

  const productKind = form.watch("productKind") ?? "product";
  const groupEditing = Boolean(form.watch("variantGroupId"));
  const variantEnabled = productKind === "product" && (!isEdit || groupEditing);
  const hasVariants = variantEnabled && (form.watch("attributes") ?? []).some((attribute) => attribute.createsVariants !== false);
  const rawError = form.formState.errors.root?.message ?? form.formState.errors.variantChildren?.message ?? form.formState.errors.attributes?.message;
  const displayError = rawError && rawError.includes(".") && !rawError.includes(" ") ? t(rawError) : rawError;

  return (
    <Form
      form={form}
      onSubmit={onSubmit}
      className={cn(
        "flex flex-col space-y-0",
        isModal
          ? "h-full min-h-0 bg-surface"
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
              className="h-11 w-11 shrink-0 rounded-xl lg:h-9 lg:w-9"
            >
              <ArrowLeft className="h-5 w-5 lg:h-4 lg:w-4" />
            </Button>
          )}
          <Heading
            id={isModal ? "product-editor-title" : undefined}
            as="h1"
            size="lg"
            text={groupEditing ? (form.watch("variantOperation") === "add" ? "Thêm biến thể" : "Sửa nhóm biến thể") : t(
              isEdit
                ? `products.kind.editTitles.${productKind}`
                : `products.kind.createTitles.${productKind}`,
            )}
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
            showDirectSale={!groupEditing && !hasVariants}
            registerDirectSale={form.register("directSale")}
            onCancel={close}
            onIntent={setSubmitIntent}
          />
        )}
      </header>

      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6">
        <div className="flex gap-6 overflow-x-auto">
          {(["info", ...(productKind === "product" ? ["variants" as const] : []), "description"] as Tab[]).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className={cn(
                "py-3 text-sm font-medium border-b-2 transition-colors min-h-11 min-w-11",
                tab === tk
                  ? "border-primary-600 text-primary-600"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400",
              )}
            >
              {tk === "description" ? "Mô tả, ghi chú" : t(`products.tabs.${tk}`)}
            </button>
          ))}
        </div>
      </div>

      {rawError && (
        <div className="bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900 px-4 sm:px-6 py-2 text-sm text-red-700 dark:text-red-400">
          {displayError}
        </div>
      )}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto overscroll-contain p-4 sm:p-6 w-full space-y-4",
          isModal ? "mx-auto max-w-7xl" : "mx-auto max-w-5xl",
        )}
      >
        {groupEditing && <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
          <p className="font-semibold">{form.watch("variantOperation") === "add" ? "Thêm biến thể vào nhóm" : "Sửa nhóm biến thể"}: {variantGroup?.name ?? form.watch("name")}</p>
          <p className="mt-1">Giữ SKU đã có; hàng mới được thêm vào cùng nhóm. Nội dung riêng của từng SKU được giữ nguyên.</p>
        </div>}
        {tab === "info" && (
          <InfoTab
            storeId={storeId}
            publicMediaBaseUrl={publicMediaBaseUrl}
            categories={categories}
            brands={brands}
            priceBooks={priceBooks}
            comboProducts={comboProducts}
            mode={mode}
            creationKind={creationKind}
            initialManagedImages={initialManagedImages}
            groupEditing={groupEditing}
          />
        )}
        {tab === "variants" && (
          <VariantsTab
            isEdit={isEdit}
            isVariantChild={isVariantChild}
            siblingCount={siblingCount}
            groupEditing={groupEditing}
            groupId={variantGroup?.id}
          />
        )}
        <VariantChildrenField visible={tab === "variants"} enabled={variantEnabled} />
        {tab === "description" && <DescriptionTab />}
        {hasVariants && !groupEditing && tab === "info" && <p className="text-sm text-slate-500">Giá chung dùng cho SKU mới. Nhập giá và tồn từng biến thể tại tab Đơn vị & thuộc tính.</p>}
      </div>

      {isModal && (
        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-3">
          <FormActions
            loading={form.formState.isSubmitting}
            showDirectSale={!groupEditing && !hasVariants}
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
  showDirectSale = true,
  align = "header",
}: {
  loading: boolean;
  registerDirectSale: UseFormRegisterReturn<"directSale">;
  onCancel: () => void;
  onIntent: (intent: "save" | "sameType") => void;
  showDirectSale?: boolean;
  align?: "header" | "footer";
}) {
  const t = useTranslations();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        align === "footer" && "grid grid-cols-1 sm:flex sm:justify-between",
      )}
    >
      {showDirectSale && <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-sm lg:min-h-0 lg:min-w-0">
        <Checkbox
          {...registerDirectSale}
        />
        <span>{t("products.directSale")}</span>
      </label>}
      <div
        className={cn(
          "ml-auto flex flex-wrap items-center gap-2",
          align === "footer" && "grid w-full grid-cols-2 sm:ml-auto sm:flex sm:w-auto",
        )}
      >
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          tx="common.cancel"
          className={align === "footer" ? "order-1 w-full sm:order-none sm:w-auto" : undefined}
        />
        <Button
          type="submit"
          variant="secondary"
          onClick={() => onIntent("sameType")}
          tx="products.saveAndCreateSameType"
          className={align === "footer" ? "order-3 col-span-2 w-full sm:order-none sm:w-auto" : undefined}
        />
        <Button
          type="submit"
          loading={loading}
          onClick={() => onIntent("save")}
          tx="common.save"
          className={align === "footer" ? "order-2 w-full sm:order-none sm:w-auto" : undefined}
        />
      </div>
    </div>
  );
}

function InfoTab({
  storeId,
  publicMediaBaseUrl,
  categories,
  brands,
  priceBooks,
  comboProducts,
  initialManagedImages,
  groupEditing,
}: NewProductFormProps & { groupEditing: boolean }) {
  const { watch } = useFormCtx();
  const productKind = watch("productKind") ?? "product";
  const groupAdding = groupEditing && watch("variantOperation") === "add";
  if (groupAdding) return <Section title="Thông tin nhóm" collapsible={false}>
    <p className="mb-4 text-sm text-slate-500">Đang thêm SKU vào nhóm này. Thông tin chung được giữ nguyên; nhập thuộc tính, giá và tồn đầu của SKU mới ở tab Đơn vị &amp; thuộc tính.</p>
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-sm text-slate-500">Tên nhóm</dt><dd className="mt-1 font-medium">{watch("name")}</dd></div>
      <div><dt className="text-sm text-slate-500">Nhóm hàng</dt><dd className="mt-1">{categories.find((category) => category.id === watch("categoryId"))?.name ?? "—"}</dd></div>
      <div><dt className="text-sm text-slate-500">Thương hiệu</dt><dd className="mt-1">{brands.find((brand) => brand.id === watch("brandId"))?.name ?? "—"}</dd></div>
    </dl>
  </Section>;
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-5">
        <BasicInfoSection categories={categories} brands={brands} groupEditing={groupEditing} />
        {productKind === "combo" && (
          <ComboItemsField products={comboProducts ?? []} />
        )}
        {!groupEditing && <Section
          titleTx="products.sections.pricing"
          className="rounded-none border-x-0 border-b-0 shadow-none"
        >
          <PricingFields priceBooks={priceBooks ?? []} />
        </Section>}
        {productKind === "product" && (
          <>
            <Section
              titleTx="products.sections.stock"
              className="rounded-none border-x-0 border-b-0 shadow-none"
            >
              <StockFields />
            </Section>
            {!groupEditing && <Section
              titleTx="products.sections.physical"
              descriptionTx="products.sections.physicalDesc"
              defaultOpen={false}
              className="rounded-none border-x-0 border-b-0 shadow-none"
            >
              <PhysicalFields />
            </Section>}
          </>
        )}
      </div>
      <aside className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <ImageUploadGrid
          storeId={storeId}
          publicMediaBaseUrl={publicMediaBaseUrl}
          initialManagedImages={initialManagedImages ?? []}
        />
      </aside>
    </div>
  );
}

function ComboItemsField({
  products: candidates,
}: {
  products: ProductFormOptions["comboProducts"];
}) {
  const t = useTranslations();
  const { watch, setValue, formState } = useFormCtx();
  const items = watch("comboItems") ?? [];
  const currentCostPrice = Number(watch("costPrice") ?? 0);
  const candidatesById = useMemo(
    () => new Map(candidates.map((product) => [product.id, product])),
    [candidates],
  );
  const calculatedCostPrice = items.reduce((total, item) => {
    const product = candidatesById.get(item.productId);
    return (
      total + Number(product?.costPrice ?? 0) * Number(item.quantity || 0)
    );
  }, 0);
  const selectedIds = new Set(items.map((item) => item.productId));
  const options = candidates
    .filter((product) => product.isActive && !selectedIds.has(product.id))
    .map((product) => ({
      value: product.id,
      label: product.name,
      hint: `${product.sku} · ${product.baseUnit}`,
      imageUrl: product.imageUrls?.[0] ?? null,
      description: `${t("products.combo.costPrice")}: ${formatCurrency(Number(product.costPrice))} · ${t("products.combo.salePrice")}: ${formatCurrency(Number(product.retailPrice))} · ${t("products.combo.stock")}: ${
        product.productKind === "service"
          ? t("products.stock.notTracked")
          : `${formatNumber(Number(product.totalStock))} ${product.baseUnit}`
      }`,
    }));

  useEffect(() => {
    if (Math.abs(currentCostPrice - calculatedCostPrice) < 0.0001) return;
    setValue("costPrice", calculatedCostPrice, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [calculatedCostPrice, currentCostPrice, setValue]);

  function addItem(productId: string) {
    if (!productId || selectedIds.has(productId)) return;
    setValue(
      "comboItems",
      [...items, { productId, quantity: 1 }],
      { shouldDirty: true, shouldValidate: true },
    );
  }

  return (
    <Section
      titleTx="products.combo.sectionTitle"
      descriptionTx="products.combo.sectionDesc"
      collapsible={false}
    >
      <Combobox
        value=""
        onChange={addItem}
        options={options}
        placeholder={t("products.combo.selectProduct")}
        showSearch
        allowClear={false}
      />

      {items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-surface-2 px-4 py-6 text-center text-sm text-slate-500">
          {t("products.combo.empty")}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-border-soft overflow-hidden rounded-xl border border-border">
          {items.map((item, index) => {
            const product = candidates.find(
              (candidate) => candidate.id === item.productId,
            );
            return (
              <div
                key={item.productId}
                className="flex flex-wrap items-center gap-3 bg-surface px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {product?.name ?? item.productId}
                  </div>
                  <div className="text-xs text-slate-500">
                    {product?.sku} · {product?.baseUnit}
                  </div>
                  {product && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>
                        <span className="text-slate-500">
                          {t("products.combo.costPrice")}:
                        </span>{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {formatCurrency(Number(product.costPrice))}
                        </span>
                      </span>
                      <span>
                        <span className="text-slate-500">
                          {t("products.combo.salePrice")}:
                        </span>{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {formatCurrency(Number(product.retailPrice))}
                        </span>
                      </span>
                      <span>
                        <span className="text-slate-500">
                          {t("products.combo.stock")}:
                        </span>{" "}
                        <span
                          className={cn(
                            "font-semibold",
                            product.productKind === "service"
                              ? "text-slate-400"
                              : "text-slate-700 dark:text-slate-200",
                          )}
                        >
                          {product.productKind === "service"
                            ? t("products.stock.notTracked")
                            : `${formatNumber(Number(product.totalStock))} ${product.baseUnit}`}
                        </span>
                      </span>
                      {!product.isActive && (
                        <span className="font-medium text-amber-600">
                          {t("products.list.inactive")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">
                    {t("products.combo.quantity")}
                  </span>
                  <QuantityInput
                    value={item.quantity}
                    min={0.0001}
                    decimals={4}
                    onChange={(quantity) => {
                      setValue(
                        `comboItems.${index}.quantity`,
                        quantity,
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }}
                    className="w-[132px] lg:w-32"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  onClick={() =>
                    setValue(
                      "comboItems",
                      items.filter((_, itemIndex) => itemIndex !== index),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {formState.errors.comboItems?.message && (
        <p className="mt-2 text-xs text-red-600">
          {t(formState.errors.comboItems.message)}
        </p>
      )}
    </Section>
  );
}

function DescriptionTab() {
  const { register, watch } = useFormCtx();
  const groupEditing = Boolean(watch("variantGroupId"));
  const groupAdding = groupEditing && watch("variantOperation") === "add";
  return (
    <div className="space-y-4">
      <Section title="Mô tả và thông số kỹ thuật" description="Thông số như băng tần, nguồn cấp, MIMO và hướng dẫn cài đặt được ghi ở đây; không tạo thêm SKU." collapsible={false}>
        {groupAdding
          ? <div className="space-y-3"><p className="text-sm text-slate-500">Mô tả chung được giữ nguyên khi thêm SKU. Dùng Sửa nhóm biến thể để cập nhật nội dung này.</p><p className="whitespace-pre-wrap text-sm">{watch("description") || "Chưa có mô tả."}</p></div>
          : <Textarea {...register("description")} aria-label="Mô tả và thông số kỹ thuật" rows={8} />}
      </Section>
      {!groupEditing && <Section titleTx="products.description.invoiceNote" collapsible={false}>
        <Textarea {...register("invoiceNote")} aria-label="Mẫu ghi chú hóa đơn, đặt hàng" rows={4} />
      </Section>}
    </div>
  );
}

function VariantsTab({
  isEdit,
  isVariantChild,
  siblingCount,
  groupEditing,
  groupId,
}: {
  groupEditing: boolean;
  groupId?: string;
  isEdit: boolean;
  isVariantChild: boolean;
  siblingCount: number;
}) {
  return (
    <div className="space-y-4">
      <Section
        {...(groupEditing
          ? {
              title: "Đơn vị mặc định cho SKU mới",
              description: "Chỉ áp dụng cho SKU mới tạo trong nhóm. Đơn vị của SKU đã có được giữ nguyên và hiển thị khóa trong bảng bên dưới.",
            }
          : {
              titleTx: "products.sections.units",
              descriptionTx: "products.sections.unitsDesc",
            })}
        collapsible={false}
      >
        <MultiUnitField />
      </Section>
      <Section
        title="Thuộc tính tạo biến thể"
        description="Chọn đặc điểm phân biệt hàng bán như phiên bản, màu, dung tích. Mỗi tổ hợp tương ứng một SKU."
        collapsible={false}
      >
        <AttributesField locked={isEdit && !groupEditing} />
        {isEdit && !groupEditing && <p className="mt-3 text-sm text-slate-500">Giá trị này xác định SKU đang sửa. {groupId && <a className="font-medium text-primary-600 underline" href={`${Routes.productEdit(groupId)}?groupEdit=1`}>Sửa nhóm biến thể</a>}</p>}
      </Section>
      {isEdit && isVariantChild && !groupEditing && (
        <SiblingApplySection siblingCount={siblingCount} />
      )}
    </div>
  );
}

const APPLY_FIELD_OPTIONS = [
  "name",
  "imageUrls",
  "category",
  "brand",
  "pricing",
  "units",
  "directSale",
] as const;

function SiblingApplySection({ siblingCount }: { siblingCount: number }) {
  const t = useTranslations();
  const { register, watch } = useFormCtx();
  const enabled = Boolean(watch("applyToSiblings.enabled"));

  return (
    <Section title={t("products.variants.applyTitle")} collapsible={false}>
      <div className="space-y-3">
        <label className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 min-h-11 min-w-11">
          <Checkbox
            {...register("applyToSiblings.enabled")}
            className="mt-1"
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
                className="flex min-h-11 min-w-11 items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm lg:min-h-0 lg:min-w-0"
              >
                <Checkbox
                  value={opt}
                  {...register("applyToSiblings.fields")}
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

function BasicInfoSection({
  categories,
  brands,
  groupEditing,
}: Pick<NewProductFormProps, "categories" | "brands"> & { groupEditing: boolean }) {
  const t = useTranslations();
  const { register, watch, setValue } = useFormCtx();
  const [extraCats, setExtraCats] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [extraBrands, setExtraBrands] = useState<
    { id: string; name: string }[]
  >([]);

  return (
    <div className="space-y-4 px-1 sm:px-4">
      {!groupEditing && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>}

      <FormField name="name" labelTx="products.fields.name" required>
        {(field) => (
          <Input
            {...field}
            placeholderTx="products.fields.namePlaceholder"
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      {groupEditing && <p className="text-sm text-slate-500">SKU, mã vạch, giá và tồn kho được chỉnh trên từng dòng ở tab Đơn vị &amp; thuộc tính.</p>}
    </div>
  );
}

const MAX_IMAGES = 10;

function ImageUploadGrid({
  storeId,
  publicMediaBaseUrl,
  initialManagedImages,
}: {
  storeId: string;
  publicMediaBaseUrl: string;
  initialManagedImages: UploadedProductImage[];
}) {
  const t = useTranslations();
  const { watch, setValue } = useFormCtx();
  const urls: string[] = watch("imageUrls") ?? [];
  const initialMediaIds = useMemo(
    () => new Set(initialManagedImages.map((image) => image.mediaId)),
    [initialManagedImages],
  );
  const [managedImages, setManagedImages] = useState(initialManagedImages);
  const [drafts, setDrafts] = useState<ProductImageUploadDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showAllImages, setShowAllImages] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryId = useId();
  const previewUrl = selectedUrl && urls.includes(selectedUrl) ? selectedUrl : urls[0];
  const previewIndex = urls.indexOf(previewUrl);
  const visibleUrls = showAllImages ? urls : urls.slice(0, 4);

  function setImageState(
    nextUrls: string[],
    nextManagedImages: UploadedProductImage[],
  ) {
    const managedByUrl = new Map(
      nextManagedImages.map((image) => [image.url, image]),
    );
    const orderedManaged = nextUrls.flatMap((url) => {
      const image = managedByUrl.get(url);
      return image ? [image] : [];
    });
    setManagedImages(orderedManaged);
    setValue("imageUrls", nextUrls, { shouldDirty: true });
    setValue(
      "imageMediaIds",
      orderedManaged.map((image) => image.mediaId),
      { shouldDirty: true },
    );
  }

  function addImageUrl() {
    if (uploading || urls.length >= MAX_IMAGES) return;
    const value = urlInput.trim();
    setErr("");
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      if (urls.includes(value)) {
        setUrlInput("");
        return;
      }
      setImageState([...urls, value], managedImages);
      setSelectedUrl(value);
      setUrlInput("");
      setShowUrlInput(false);
    } catch {
      setErr(t("products.fields.imageUrlInvalid"));
    }
  }

  async function uploadFiles(nextDrafts: ProductImageUploadDraft[]) {
    if (nextDrafts.length === 0) return;
    setErr("");
    setUploading(true);
    const result = await uploadProductImageFiles({
      completed: [],
      drafts: nextDrafts,
      targetId: storeId,
      publicMediaBaseUrl,
    });
    if (result.completed.length > 0) {
      setImageState(
        [...urls, ...result.completed.map((image) => image.url)],
        [...managedImages, ...result.completed],
      );
    }
    setDrafts(result.remaining);
    if (result.error) setErr(t("products.fields.imageUploadError"));
    setUploading(false);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const available = MAX_IMAGES - urls.length;
    const nextDrafts = [
      ...drafts,
      ...Array.from(files, (file) => ({ file })),
    ].slice(0, available);
    setDrafts(nextDrafts);
    await uploadFiles(nextDrafts);
  }

  const remove = async (url: string) => {
    const image = managedImageToDeleteImmediately({
      url,
      managedImages,
      initialMediaIds,
    });
    setImageState(
      urls.filter((candidate) => candidate !== url),
      managedImages.filter((candidate) => candidate.url !== url),
    );
    if (image) {
      try {
        await deleteUploadedProductImage(image);
      } catch {
        setErr(t("products.fields.imageUploadError"));
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm space-y-3 lg:max-w-none" aria-busy={uploading}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("products.fields.image")}</h2>
        <span className="text-xs tabular-nums text-slate-500">{urls.length}/{MAX_IMAGES}</span>
      </div>
      {previewUrl ? (
        <div className="relative mx-auto h-[200px] w-full max-w-[220px] overflow-hidden rounded-xl border border-border bg-white">
          <Image
            src={previewUrl}
            alt={t("products.fields.imagePreview", { index: previewIndex + 1 })}
            fill
            sizes="220px"
            className="object-contain p-3"
            unoptimized
          />
          {previewIndex === 0 && (
            <span className="absolute left-2 top-2 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white">
              {t("products.fields.primaryImage")}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="iconSm"
            disabled={uploading}
            onClick={() => void remove(previewUrl)}
            className="absolute right-2 top-2 h-11 w-11 bg-surface lg:h-9 lg:w-9"
            aria-label={t("products.fields.removeImage", { index: previewIndex + 1 })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex h-[160px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 text-slate-500">
          <ImagePlus className="h-7 w-7" />
          <span className="text-sm">{t("products.fields.noImages")}</span>
        </div>
      )}
      {urls.length > 1 && (
        <div id={`${galleryId}-thumbnails`} className="grid grid-cols-4 gap-2">
          {visibleUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setSelectedUrl(url)}
              aria-label={t("products.fields.imagePreview", { index: index + 1 })}
              aria-pressed={url === previewUrl}
              className={cn(
                "relative aspect-square min-h-11 overflow-hidden rounded-lg border bg-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600",
                url === previewUrl ? "border-primary-600 ring-1 ring-primary-600" : "border-border hover:border-primary-400",
              )}
            >
              <Image src={url} alt="" fill sizes="64px" className="object-contain p-1" unoptimized />
            </button>
          ))}
        </div>
      )}
      {urls.length > 4 && (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          aria-expanded={showAllImages}
          aria-controls={`${galleryId}-thumbnails`}
          onClick={() => setShowAllImages((value) => !value)}
        >
          {showAllImages ? t("products.fields.collapseImages") : t("products.fields.showAllImages", { count: urls.length })}
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={PRODUCT_IMAGE_ACCEPT}
        multiple
        disabled={uploading || urls.length >= MAX_IMAGES}
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
        className="hidden"
      />
      {urls.length < MAX_IMAGES && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {!uploading && <ImagePlus className="h-4 w-4" />}
            {t("products.fields.addImage")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={uploading}
            aria-expanded={showUrlInput}
            aria-controls={`${galleryId}-url`}
            onClick={() => setShowUrlInput((value) => !value)}
          >
            <Link2 className="h-4 w-4" />
            {t("products.fields.addFromUrl")}
          </Button>
          {showUrlInput && (
            <div id={`${galleryId}-url`} className="space-y-2">
              <Input
                type="url"
                autoFocus
                value={urlInput}
                disabled={uploading}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addImageUrl();
                  }
                }}
                placeholder={t("products.fields.imageUrlPlaceholder")}
                aria-label={t("products.fields.imageUrl")}
                aria-invalid={Boolean(err)}
                aria-describedby={err ? `${galleryId}-error` : undefined}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addImageUrl}
                disabled={uploading || !urlInput.trim()}
                tx="products.fields.addImageUrl"
                className="w-full"
              />
            </div>
          )}
        </>
      )}
      {drafts.length > 0 && !uploading && (
        <Button type="button" variant="secondary" onClick={() => void uploadFiles(drafts)} className="w-full">
          {t("common.retry")}
        </Button>
      )}
      {err ? (
        <p id={`${galleryId}-error`} role="alert" className="text-xs text-red-600">{err}</p>
      ) : (
        <p className="text-xs leading-relaxed text-slate-500">{t("products.fields.imageHint")}</p>
      )}
    </div>
  );
}

function PricingFields({ priceBooks }: { priceBooks: PriceBookRow[] }) {
  const t = useTranslations();
  const { setValue, watch } = useFormCtx();
  const isCombo = watch("productKind") === "combo";
  const priceBookPrices = watch("priceBookPrices") ?? {};
  const [open, setOpen] = useState(false);
  const [draftOverrides, setDraftOverrides] =
    useState<Record<string, number | null>>(priceBookPrices);

  function openPriceBooks() {
    setDraftOverrides({ ...(watch("priceBookPrices") ?? {}) });
    setOpen(true);
  }

  function applyPriceBooks() {
    setValue("priceBookPrices", draftOverrides, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setOpen(false);
  }

  const activeBooks = priceBooks.filter((book) => !book.isDefault && !isPriceBookReadOnly(book));

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_1fr_auto] lg:grid-cols-[1fr_1fr_auto]">
        <Field
          labelTx="products.pricing.costPrice"
          hintTx={isCombo ? "products.combo.costAutoHint" : undefined}
        >
          <NumberInput
            value={watch("costPrice")}
            onChange={(v) => setValue("costPrice", v ?? 0)}
            suffix="đ"
            min={0}
            readOnly={isCombo}
            className={cn(isCombo && "bg-surface-2 text-slate-600")}
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
          disabled={activeBooks.length === 0}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary-600 hover:bg-primary-50 md:mt-[30px] dark:hover:bg-primary-950/30 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
        >
          <Tag className="h-4 w-4" />
          {t("products.pricing.setupPriceBooks")}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-0 sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-price-books-title"
            className="flex h-dvh w-full max-w-5xl flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:max-h-[88dvh] sm:rounded-2xl"
          >
            <header className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
              <div>
                <h3
                  id="product-price-books-title"
                  className="text-xl font-bold text-slate-900 dark:text-slate-100"
                >
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
                className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 lg:h-9 lg:w-9"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pb-4 sm:px-6" data-mobile-audit="product-price-books">
              <table className="block w-full min-w-0 text-sm lg:table lg:min-w-[640px]">
                <thead className="hidden lg:table-header-group">
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
                <tbody className="block divide-y divide-border-soft lg:table-row-group">
                  {activeBooks.map((book) => {
                    const value = draftOverrides[book.id] ?? null;
                    return (
                      <tr key={book.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-3 lg:table-row lg:py-0">
                        <td className="col-span-2 block p-0 break-words font-medium lg:table-cell lg:px-4 lg:py-3">{book.name}</td>
                        <td className="block p-0 lg:table-cell lg:px-4 lg:py-3">
                          <div className="mb-1 text-xs font-semibold text-slate-500 lg:hidden">{t("products.pricing.retailPrice")}</div>
                          <NumberInput
                            value={value}
                            onChange={(next) => {
                              setDraftOverrides((current) => ({
                                  ...current,
                                  [book.id]: next,
                                }));
                            }}
                            suffix="đ"
                            min={0}
                            className="min-h-11 w-full lg:ml-auto lg:max-w-[260px] lg:min-h-0"
                          />
                        </td>
                        <td className="block p-0 text-right lg:table-cell lg:px-4 lg:py-3">
                          {!book.isDefault && (
                            <button
                              type="button"
                              onClick={() =>
                                setDraftOverrides((current) => ({
                                  ...current,
                                  [book.id]: null,
                                }))
                              }
                              className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-er lg:h-9 lg:w-9"
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
            <footer className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:px-6 sm:pb-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                tx="common.cancel"
                className="w-full sm:w-auto"
              />
              <Button
                type="button"
                onClick={applyPriceBooks}
                tx="common.done"
                className="w-full sm:w-auto"
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
  const currentStock = watch("currentStock");
  const editingStock = currentStock !== undefined;
  const groupEditing = Boolean(watch("variantGroupId"));
  const hasVariants = groupEditing || (!editingStock && (watch("attributes") ?? []).some((attribute) => attribute.createsVariants !== false));
  if (hasVariants) return <p className="text-sm text-slate-500">Tồn được quản lý trên từng SKU trong tab Đơn vị & thuộc tính. Nhóm không có tồn riêng.</p>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field labelTx="products.stock.current">
        <NumberInput
          value={editingStock ? currentStock : watch("initialStock")}
          onChange={(v) => setValue(editingStock ? "currentStock" : "initialStock", v ?? 0)}
          min={editingStock ? undefined : 0}
          decimals={4}
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
