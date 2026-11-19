"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input, MoneyInput, QuantityInput, Select } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { buildVariantCombinations } from "@/lib/products/variant-model";
import { compareVariantValues } from "@/lib/products/variant-presentation";
import type { CreateProductInput } from "./schema";
import { initialVariantCombinationBudget, reconcileVariantChildDrafts } from "./variant-child-drafts";
import { useTranslations } from "next-intl";
import {
  bulkAdjustedPrice,
  isValidBulkPriceInput,
  variantRowMatches,
  type VariantBulkPriceField,
  type VariantBulkPriceMode,
  type VariantRowStatusFilter,
} from "@/lib/products/variant-bulk-edit";

const STATUS_OPTIONS: { value: VariantRowStatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả dòng" },
  { value: "new", label: "SKU mới" },
  { value: "existing", label: "SKU đã có" },
];
const FIELD_OPTIONS: { value: VariantBulkPriceField; label: string }[] = [
  { value: "retailPrice", label: "Giá bán" },
  { value: "costPrice", label: "Giá nhập" },
];
const MODE_OPTIONS: { value: VariantBulkPriceMode; label: string }[] = [
  { value: "set", label: "Đặt bằng (đ)" },
  { value: "percent", label: "Tăng/giảm %" },
  { value: "amount", label: "Tăng/giảm (đ)" },
];

/** "10.000" and "-5.000" are đồng; a percent keeps its decimal separator ("2,5" → 2.5). */
function parseBulkValue(text: string, mode: VariantBulkPriceMode) {
  const trimmed = text.trim().replace(/\s/g, "");
  if (!trimmed) return Number.NaN;
  return Number(mode === "percent" ? trimmed.replace(",", ".") : trimmed.replace(/[.,]/g, ""));
}

type Child = NonNullable<CreateProductInput["variantChildren"]>[number];
const EMPTY_ATTRIBUTES: NonNullable<CreateProductInput["attributes"]> = [];
const EMPTY_CHILDREN: Child[] = [];
const EMPTY_KEYS: string[] = [];

/** Stays mounted while switching tabs so hidden fields never submit stale rows. */
export function VariantChildrenField({ visible, enabled, layout = "default" }: { visible: boolean; enabled: boolean; layout?: "default" | "ios" }) {
  const t = useTranslations();
  const { control, register, getValues, setValue, formState } = useFormContext<CreateProductInput>();
  const attributes = useWatch({ control, name: "attributes" }) ?? EMPTY_ATTRIBUTES;
  const children = useWatch({ control, name: "variantChildren" }) ?? EMPTY_CHILDREN;
  const excluded = useWatch({ control, name: "excludedCombinationKeys" }) ?? EMPTY_KEYS;
  const [maxCombinations] = useState(() => initialVariantCombinationBudget(getValues()));
  const cached = useRef(new Map<string, Child>());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<VariantRowStatusFilter>("all");
  const [bulkField, setBulkField] = useState<VariantBulkPriceField>("retailPrice");
  const [bulkMode, setBulkMode] = useState<VariantBulkPriceMode>("set");
  const [bulkText, setBulkText] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const generated = useMemo(() => {
    if (!enabled) return { rows: [], error: "" };
    try { return { rows: buildVariantCombinations(attributes.map((attribute) => ({ ...attribute, values: attribute.values ?? [] })), { maxCombinations }), error: "" }; }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : "Kiểm tra lại các giá trị thuộc tính." }; }
  }, [attributes, enabled, maxCombinations]);

  useEffect(() => {
    if (!enabled || generated.error) return;
    for (const child of children) if (child.combinationKey) cached.current.set(child.combinationKey, child);
    const current = getValues();
    const rows = generated.rows.filter((row) => !excluded.includes(row.combinationKey));
    // Saved SKU membership must be changed through an explicit lifecycle action.
    // Never remove a saved SKU because a draft definition is temporarily incomplete.
    if (children.some((child) => child.productId && !rows.some((row) => row.combinationKey === child.combinationKey))) return;
    const next = reconcileVariantChildDrafts(rows, [...cached.current.values()], current);
    if (JSON.stringify(next) !== JSON.stringify(children)) setValue("variantChildren", next, { shouldDirty: true });
    const validKeys = new Set(generated.rows.map((row) => row.combinationKey));
    const validExcluded = excluded.filter((key) => validKeys.has(key));
    if (validExcluded.length !== excluded.length) setValue("excludedCombinationKeys", validExcluded, { shouldDirty: true });
  }, [children, enabled, excluded, generated, getValues, setValue]);

  if (!visible || !enabled) return null;
  const issue = formState.errors.variantChildren?.message;
  const rowsByKey = new Map(children.map((child, index) => [child.combinationKey, { child, index }]));
  const savedCount = children.filter((child) => child.productId).length;
  const unassigned = children.filter((child) => child.productId && !generated.rows.some((row) => row.combinationKey === child.combinationKey));
  const newCount = children.length - savedCount;
  const inputClass = "min-h-11 lg:min-h-0";
  const tdClass = "block p-0 lg:table-cell lg:px-3 lg:py-3";

  // Display order follows option values naturally (30W, 50W, 100W); saving uses combination keys.
  const visibleRows = generated.rows.filter((row) => {
    const child = rowsByKey.get(row.combinationKey)?.child;
    return variantRowMatches({ variantName: row.variantName, sku: child?.sku, persisted: Boolean(child?.productId) }, query, statusFilter);
  }).sort((left, right) => compareVariantValues(left.variantName, right.variantName));
  // Only rows that will be saved can take a price: excluded or unassigned combinations are skipped.
  const bulkTargets = visibleRows.flatMap((row) => {
    const item = rowsByKey.get(row.combinationKey);
    return item && !excluded.includes(row.combinationKey) ? [item.index] : [];
  });
  const bulkValue = parseBulkValue(bulkText, bulkMode);
  const bulkReady = bulkTargets.length > 0 && isValidBulkPriceInput(bulkMode, bulkValue);

  function applyBulkPrice() {
    if (!bulkReady) return;
    const targets = new Set(bulkTargets);
    const next = (getValues("variantChildren") ?? []).map((child, index) => targets.has(index)
      ? { ...child, [bulkField]: bulkAdjustedPrice(child[bulkField], bulkMode, bulkValue) }
      : child);
    setValue("variantChildren", next, { shouldDirty: true });
    setBulkNotice(`Đã cập nhật ${FIELD_OPTIONS.find((option) => option.value === bulkField)?.label.toLocaleLowerCase("vi")} cho ${targets.size} SKU.`);
    setBulkText("");
  }

  function toggle(key: string, checked: boolean) {
    setValue("excludedCombinationKeys", checked ? excluded.filter((item) => item !== key) : [...excluded, key], { shouldDirty: true });
  }

  if (layout === "ios") {
    // Phone variants screen: mirrors NativeProductVariantsView (bulk price section, then SKU cards).
    const label = "mb-2 block text-[15px] text-slate-500";
    const assignSelect = (child: Child) => <Select value="" placeholder="Chọn tổ hợp của SKU này" aria-label={`Tổ hợp của ${child.sku}`} menuMinWidth={260}
      options={generated.rows.filter((row) => !children.some((other) => other.productId && other.combinationKey === row.combinationKey)).map((row) => ({ value: row.combinationKey, label: row.variantName }))}
      onValueChange={(key) => {
        const row = generated.rows.find((candidate) => candidate.combinationKey === key);
        if (!row) return;
        setValue("variantChildren", children.filter((other) => other.productId || other.combinationKey !== key).map((other) => other.productId === child.productId ? { ...other, ...row } : other), { shouldDirty: true });
        setValue("excludedCombinationKeys", excluded.filter((existing) => existing !== key), { shouldDirty: true });
      }} />;
    return <div>
      {generated.rows.length > 1 && <section className="space-y-3.5 border-t border-border py-5" data-mobile-audit="product-variant-bulk">
        <h2 className="text-base font-semibold">{t("mobile.products.bulkPriceTitle")}</h2>
        <label className="block">
          <span className={label}>Tìm dòng</span>
          <Input className="min-h-12" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Biến thể hoặc SKU" type="search" />
        </label>
        <div role="radiogroup" aria-label="Lọc dòng" className="grid grid-cols-3 gap-1 rounded-full bg-primary-50 p-1 dark:bg-primary-950/30">
          {STATUS_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={statusFilter === option.value}
            onClick={() => setStatusFilter(option.value)}
            className={cn("min-h-10 rounded-full px-2 text-[15px] font-semibold transition-colors",
              statusFilter === option.value ? "bg-primary-600 text-white" : "text-slate-800 dark:text-slate-200")}>
            {option.value === "all" ? "Tất cả" : option.label}
          </button>)}
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div><span className={label}>Giá</span><Select value={bulkField} options={FIELD_OPTIONS} aria-label="Giá cần sửa hàng loạt" onValueChange={(value) => { setBulkField(value as VariantBulkPriceField); setBulkNotice(""); }} /></div>
          <div><span className={label}>Cách sửa</span><Select value={bulkMode} options={MODE_OPTIONS} aria-label="Cách sửa giá" onValueChange={(value) => { setBulkMode(value as VariantBulkPriceMode); setBulkNotice(""); }} /></div>
        </div>
        <div className="flex items-end gap-2.5">
          <label className="min-w-0 flex-1">
            <span className={label}>Giá trị</span>
            <Input className="min-h-12" inputMode={bulkMode === "set" ? "numeric" : "decimal"} value={bulkText}
              onChange={(event) => { setBulkText(event.target.value); setBulkNotice(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyBulkPrice(); } }}
              placeholder={bulkMode === "set" ? "Ví dụ 150.000" : bulkMode === "percent" ? "Ví dụ 10 hoặc -5" : "Ví dụ 10.000 hoặc -5.000"} />
          </label>
          <Button type="button" className="min-h-12 shrink-0 px-3.5 text-[15px]" disabled={!bulkReady} onClick={applyBulkPrice}>
            Áp dụng cho {bulkTargets.length} SKU
          </Button>
        </div>
        <p className="text-[13px] text-slate-500" aria-live="polite">
          {bulkNotice || `Đang hiển thị ${visibleRows.length}/${generated.rows.length} tổ hợp. Giá áp dụng cho các dòng đang hiển thị và được chọn.`}
        </p>
      </section>}

      <section className="border-t border-border pt-5" data-mobile-audit="product-variants">
        <h2 className="text-base font-semibold">{t("mobile.products.generatedSkus")}</h2>
        {generated.error && <p role="alert" className="mt-3 text-sm text-red-600">{t(generated.error)}</p>}
        {issue && <p role="alert" className="mt-3 text-sm text-red-600">{t(issue)}</p>}
        {unassigned.length > 0 && <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 dark:bg-amber-950/20">
          <p className="text-sm text-amber-800 dark:text-amber-200">Chọn tổ hợp cho SKU đã có trước khi thêm biến thể. SKU và lịch sử kho được giữ nguyên.</p>
          {unassigned.map((child) => <div key={child.productId} className="space-y-2">
            <div className="text-sm"><strong>{child.sku}</strong><p>{child.variantName}</p></div>
            {assignSelect(child)}
          </div>)}
        </div>}
        {!generated.rows.length && !generated.error && <p className="mt-2 text-[13px] text-slate-500">{getValues("variantGroupId") ? "Thêm thuộc tính và các giá trị, rồi gán SKU đã có vào tổ hợp tương ứng để tiếp tục." : "Chọn thuộc tính và nhập các giá trị để tạo tổ hợp."}</p>}
        {generated.rows.length > 0 && <>
          <dl className="mt-1 divide-y divide-border text-[15px]">
            <div className="flex justify-between py-2.5"><dt className="text-slate-500">{t("mobile.products.combinationCount")}</dt><dd className="font-medium tabular-nums">{generated.rows.length}</dd></div>
            <div className="flex justify-between py-2.5"><dt className="text-slate-500">{t("mobile.products.newSkuCount")}</dt><dd className="font-medium tabular-nums">{newCount}</dd></div>
          </dl>
          <div className="mt-3.5 space-y-3">
            {visibleRows.map((row) => {
              const item = rowsByKey.get(row.combinationKey);
              const child = item?.child;
              const index = item?.index ?? -1;
              const selected = !excluded.includes(row.combinationKey);
              const persisted = Boolean(child?.productId);
              const awaitingAssignment = unassigned.length > 0 && !child;
              const editable = selected && child;
              return <div key={row.combinationKey} className="space-y-3 rounded-lg border border-border bg-surface p-3.5">
                <div className="flex min-h-11 items-center justify-between gap-2.5">
                  <p className={cn("min-w-0 text-base font-semibold", !editable && "text-slate-400")}>{row.variantName}</p>
                  {persisted
                    ? <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" />{t("mobile.products.existingSku")}</span>
                    : <Toggle checked={selected && !awaitingAssignment} disabled={awaitingAssignment} onChange={(checked) => toggle(row.combinationKey, checked)} aria-label={`Chọn tổ hợp ${row.variantName}`} />}
                </div>
                {editable ? <>
                  <div className="grid grid-cols-2 gap-3.5">
                    <label><span className={label}>SKU</span><Input className="min-h-12" {...register(`variantChildren.${index}.sku`)} placeholder="Tự sinh" /></label>
                    <label><span className={label}>Mã vạch</span><Input className="min-h-12" {...register(`variantChildren.${index}.barcode`)} inputMode="numeric" /></label>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5">
                    <label><span className={label}>Giá vốn</span><MoneyInput suffix="đ" min={0} value={child.costPrice} aria-label={`${row.variantName} — Giá vốn`} onChange={(value) => setValue(`variantChildren.${index}.costPrice`, value ?? 0, { shouldDirty: true })} className="w-full" /></label>
                    <label><span className={label}>Giá bán lẻ</span><MoneyInput suffix="đ" min={0} value={child.retailPrice} aria-label={`${row.variantName} — Giá bán lẻ`} onChange={(value) => setValue(`variantChildren.${index}.retailPrice`, value ?? 0, { shouldDirty: true })} className="w-full" /></label>
                  </div>
                  {persisted
                    ? <div className="flex items-baseline justify-between text-[15px]"><span className="text-slate-500">{t("mobile.products.currentStock")}</span><span className="font-semibold tabular-nums">{formatNumber(Number(child.currentStock ?? 0))} {child.baseUnit}</span></div>
                    : <label className="block"><span className={label}>{t("mobile.products.openingStock")}</span><QuantityInput min={0} value={Number(child.initialStock ?? 0)} inputLabel={`${row.variantName} — ${t("mobile.products.openingStock")}`} onChange={(value) => setValue(`variantChildren.${index}.initialStock`, value, { shouldDirty: true })} className="w-full" touchTargets /></label>}
                </> : <p className="text-[13px] text-slate-500">{awaitingAssignment ? "Gán SKU đã có vào một tổ hợp trước." : t("mobile.products.combinationExcluded")}</p>}
              </div>;
            })}
            {visibleRows.length === 0 && <p className="py-2 text-[13px] text-slate-500">Không có tổ hợp phù hợp bộ lọc.</p>}
          </div>
        </>}
      </section>
    </div>;
  }

  return <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
    <div className="space-y-1 border-b border-border px-4 py-3">
      <h3 className="font-semibold">Hàng cùng loại</h3>
      <p className="text-sm text-slate-500">{generated.rows.length} tổ hợp · {savedCount} SKU đã có · {newCount} SKU mới · {excluded.length} tổ hợp bỏ chọn</p>
      <p className="text-xs text-slate-500">Giá và tồn nhập riêng từng SKU. Tồn của SKU đã lưu được thay đổi qua nhập hàng hoặc điều chỉnh kho.</p>
    </div>
    {generated.rows.length > 1 && <div className="space-y-3 border-b border-border bg-surface-2/60 px-4 py-3" data-mobile-audit="product-variant-bulk">
      <div className="grid grid-cols-[minmax(0,1fr)_136px] gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Input className="min-h-11 lg:min-h-0" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm biến thể, SKU" aria-label="Tìm biến thể hoặc SKU" type="search" />
        <Select value={statusFilter} options={STATUS_OPTIONS} aria-label="Lọc dòng" onValueChange={(value) => setStatusFilter(value as VariantRowStatusFilter)} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[150px_170px_minmax(0,1fr)_auto] sm:items-center">
        <Select value={bulkField} options={FIELD_OPTIONS} aria-label="Giá cần sửa hàng loạt" onValueChange={(value) => { setBulkField(value as VariantBulkPriceField); setBulkNotice(""); }} />
        <Select value={bulkMode} options={MODE_OPTIONS} aria-label="Cách sửa giá" onValueChange={(value) => { setBulkMode(value as VariantBulkPriceMode); setBulkNotice(""); }} />
        <Input className="min-h-11 lg:min-h-0" inputMode={bulkMode === "set" ? "numeric" : "decimal"} value={bulkText}
          onChange={(event) => { setBulkText(event.target.value); setBulkNotice(""); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyBulkPrice(); } }}
          placeholder={bulkMode === "set" ? "Ví dụ 150.000" : bulkMode === "percent" ? "Ví dụ 10 hoặc -5" : "Ví dụ 10.000 hoặc -5.000"}
          aria-label="Giá trị áp dụng" />
        <Button type="button" className="min-h-11 lg:min-h-0" disabled={!bulkReady} onClick={applyBulkPrice}>
          <span className="sm:hidden">Áp dụng ({bulkTargets.length})</span><span className="max-sm:hidden">Áp dụng cho {bulkTargets.length} SKU</span>
        </Button>
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {bulkNotice || `Đang hiển thị ${visibleRows.length}/${generated.rows.length} tổ hợp. Áp dụng cho các dòng đang hiển thị và được chọn.`}
      </p>
    </div>}
    {generated.error && <p role="alert" className="px-4 py-3 text-sm text-red-600">{t(generated.error)}</p>}
    {issue && <p role="alert" className="px-4 py-3 text-sm text-red-600">{t(issue)}</p>}
    {unassigned.length > 0 && <div className="space-y-3 border-b border-border bg-amber-50 p-4 dark:bg-amber-950/20">
      <p className="text-sm text-amber-800 dark:text-amber-200">Chọn tổ hợp cho SKU đã có trước khi thêm biến thể. SKU và lịch sử kho được giữ nguyên.</p>
      {unassigned.map((child) => <div key={child.productId} className="grid gap-2 sm:grid-cols-[1fr_1fr] sm:items-center">
        <div className="text-sm"><strong>{child.sku}</strong><p>{child.variantName}</p></div>
        <Select value="" placeholder="Chọn tổ hợp của SKU này" aria-label={`Tổ hợp của ${child.sku}`} menuMinWidth={260}
          options={generated.rows.filter((row) => !children.some((other) => other.productId && other.combinationKey === row.combinationKey)).map((row) => ({ value: row.combinationKey, label: row.variantName }))}
          onValueChange={(key) => {
            const row = generated.rows.find((candidate) => candidate.combinationKey === key);
            if (!row) return;
            setValue("variantChildren", children.filter((other) => other.productId || other.combinationKey !== key).map((other) => other.productId === child.productId ? { ...other, ...row } : other), { shouldDirty: true });
            setValue("excludedCombinationKeys", excluded.filter((existing) => existing !== key), { shouldDirty: true });
          }} />
      </div>)}
    </div>}
    {!generated.rows.length && !generated.error && <p className="px-4 py-4 text-sm text-slate-500">{getValues("variantGroupId") ? "Thêm thuộc tính và các giá trị, rồi gán SKU đã có vào tổ hợp tương ứng để tiếp tục." : "Thêm thuộc tính và các giá trị để tạo biến thể. Không có thuộc tính sẽ lưu một sản phẩm đơn."}</p>}
    {generated.rows.length > 0 && <div className="overflow-visible lg:overflow-x-auto" data-mobile-audit="product-variants">
      <table className="block w-full text-sm lg:table lg:min-w-[1000px]">
        <thead className="hidden bg-surface-2 text-left text-xs text-slate-500 lg:table-header-group"><tr>
          {['Chọn', 'Biến thể', 'SKU', 'Mã vạch', 'Đơn vị', 'Giá nhập', 'Giá bán', 'Tồn kho / tồn đầu', 'Bán'].map((title) => <th key={title} className="whitespace-nowrap px-3 py-2 font-semibold">{title}</th>)}
        </tr></thead>
        <tbody className="block divide-y divide-border lg:table-row-group">
          {visibleRows.map((row) => {
            const item = rowsByKey.get(row.combinationKey);
            const child = item?.child;
            const index = item?.index ?? -1;
            const selected = !excluded.includes(row.combinationKey);
            const persisted = Boolean(child?.productId);
            const awaitingAssignment = unassigned.length > 0 && !child;
            return <tr key={row.combinationKey} className={`grid grid-cols-2 gap-3 p-3 lg:table-row lg:p-0 ${!selected ? 'bg-surface-2 text-slate-400' : ''}`}>
              <td className={tdClass}><Checkbox checked={selected && !awaitingAssignment} disabled={persisted || awaitingAssignment} onChange={(event) => toggle(row.combinationKey, event.target.checked)} aria-label={`Chọn tổ hợp ${row.variantName}`} /></td>
              <td className={tdClass}>
                <p className="font-medium">{row.variantName}</p>
                <span className="mt-1 inline-flex whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-xs text-slate-500">{persisted ? 'Đã có' : awaitingAssignment ? 'Chờ gán' : selected ? 'Mới' : 'Bỏ chọn'}</span>
              </td>
              {selected && child ? <>
                <td className={tdClass}><label className="mb-1 block text-xs text-slate-500 lg:hidden">SKU</label><Input className={inputClass} {...register(`variantChildren.${index}.sku`)} aria-label={`${row.variantName} — SKU`} placeholder="Tự sinh" /></td>
                <td className={tdClass}><label className="mb-1 block text-xs text-slate-500 lg:hidden">Mã vạch</label><Input className={inputClass} {...register(`variantChildren.${index}.barcode`)} aria-label={`${row.variantName} — Mã vạch`} /></td>
                <td className={tdClass}><label className="mb-1 block text-xs text-slate-500 lg:hidden">Đơn vị</label><Input className={`${inputClass} lg:w-20`} {...register(`variantChildren.${index}.baseUnit`)} readOnly={persisted} aria-label={`${row.variantName} — Đơn vị`} /></td>
                <td className={tdClass}><label className="mb-1 block text-xs text-slate-500 lg:hidden">Giá nhập</label><MoneyInput suffix="đ" min={0} value={child.costPrice} aria-label={`${row.variantName} — Giá nhập`} onChange={(value) => setValue(`variantChildren.${index}.costPrice`, value ?? 0, { shouldDirty: true })} className="w-full lg:min-w-32" /></td>
                <td className={tdClass}><label className="mb-1 block text-xs text-slate-500 lg:hidden">Giá bán</label><MoneyInput suffix="đ" min={0} value={child.retailPrice} aria-label={`${row.variantName} — Giá bán`} onChange={(value) => setValue(`variantChildren.${index}.retailPrice`, value ?? 0, { shouldDirty: true })} className="w-full lg:min-w-32" /></td>
                <td className={tdClass}>{persisted ? <div className="whitespace-nowrap py-2"><span className="font-semibold">{formatNumber(Number(child.currentStock ?? 0))}</span> {child.baseUnit}<span className="block text-xs text-slate-500">Tồn hiện tại</span></div> : <><label className="mb-1 block text-xs text-slate-500 lg:hidden">Tồn đầu</label><QuantityInput min={0} value={Number(child.initialStock ?? 0)} inputLabel={`${row.variantName} — Tồn đầu`} onChange={(value) => setValue(`variantChildren.${index}.initialStock`, value, { shouldDirty: true })} className="w-full lg:w-32" touchTargets /></>}</td>
                <td className={tdClass}><label className="inline-flex min-h-11 items-center gap-2"><Checkbox {...register(`variantChildren.${index}.directSale`)} aria-label={`${row.variantName} — Bán trực tiếp`} /><span className="lg:hidden">Bán</span></label></td>
              </> : <td colSpan={7} className="col-span-2 py-2 text-xs lg:table-cell lg:px-3">{awaitingAssignment ? 'Gán SKU đã có vào một tổ hợp trước.' : 'Tổ hợp này sẽ không được tạo.'}</td>}
            </tr>;
          })}
        </tbody>
      </table>
      {visibleRows.length === 0 && <p className="px-4 py-4 text-sm text-slate-500">Không có tổ hợp phù hợp bộ lọc.</p>}
    </div>}
  </div>;
}
