"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, MoneyInput, QuantityInput, Select } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { buildVariantCombinations } from "@/lib/products/variant-model";
import type { CreateProductInput } from "./schema";
import { initialVariantCombinationBudget, reconcileVariantChildDrafts } from "./variant-child-drafts";
import { useTranslations } from "next-intl";

type Child = NonNullable<CreateProductInput["variantChildren"]>[number];
const EMPTY_ATTRIBUTES: NonNullable<CreateProductInput["attributes"]> = [];
const EMPTY_CHILDREN: Child[] = [];
const EMPTY_KEYS: string[] = [];

/** Stays mounted while switching tabs so hidden fields never submit stale rows. */
export function VariantChildrenField({ visible, enabled }: { visible: boolean; enabled: boolean }) {
  const t = useTranslations();
  const { control, register, getValues, setValue, formState } = useFormContext<CreateProductInput>();
  const attributes = useWatch({ control, name: "attributes" }) ?? EMPTY_ATTRIBUTES;
  const children = useWatch({ control, name: "variantChildren" }) ?? EMPTY_CHILDREN;
  const excluded = useWatch({ control, name: "excludedCombinationKeys" }) ?? EMPTY_KEYS;
  const [maxCombinations] = useState(() => initialVariantCombinationBudget(getValues()));
  const cached = useRef(new Map<string, Child>());
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

  function toggle(key: string, checked: boolean) {
    setValue("excludedCombinationKeys", checked ? excluded.filter((item) => item !== key) : [...excluded, key], { shouldDirty: true });
  }

  return <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
    <div className="space-y-1 border-b border-border px-4 py-3">
      <h3 className="font-semibold">Hàng cùng loại</h3>
      <p className="text-sm text-slate-500">{generated.rows.length} tổ hợp · {savedCount} SKU đã có · {newCount} SKU mới · {excluded.length} tổ hợp bỏ chọn</p>
      <p className="text-xs text-slate-500">Giá và tồn nhập riêng từng SKU. Tồn của SKU đã lưu được thay đổi qua nhập hàng hoặc điều chỉnh kho.</p>
    </div>
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
          {generated.rows.map((row) => {
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
                <span className="mt-1 inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-xs text-slate-500">{persisted ? 'Đã có' : awaitingAssignment ? 'Chờ gán' : selected ? 'Mới' : 'Bỏ chọn'}</span>
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
    </div>}
  </div>;
}
