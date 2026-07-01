"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import { AiQuickActionButton } from "@/components/ai-quick-actions/ai-quick-action-button";
import { AiQuickActionModal } from "@/components/ai-quick-actions/ai-quick-action-modal";
import type { AiQuickActionApplyMode } from "@/components/ai-quick-actions/types";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { createPurchaseReturn, searchPurchaseReturnProducts } from "@/lib/actions/purchase-returns";
import type { AiActionPreview } from "@/lib/ai/actions";
import type { PurchaseFormOptions } from "@/lib/data/inventory";
import type { PurchaseReturnProductRow } from "@/lib/data/purchase-returns";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type Line = {
  productId: string;
  sku: string;
  name: string;
  unitName: string;
  stock: number;
  quantity: number;
  unitCost: number;
  returnUnitCost: number;
};

function productToLine(product: PurchaseReturnProductRow): Line {
  const cost = Number(product.costPrice) || 0;
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitName: product.baseUnit,
    stock: Number(product.totalStock) || 0,
    quantity: 1,
    unitCost: cost,
    returnUnitCost: cost,
  };
}

export function PurchaseReturnForm({ options }: { options: PurchaseFormOptions }) {
  const t = useTranslations();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(options.suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(options.warehouses[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PurchaseReturnProductRow[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState(0);
  const [vatRate, setVatRate] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundMethod, setRefundMethod] = useState<"cash" | "bank_transfer">("cash");
  const [applyDebt, setApplyDebt] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiQuickOpen, setAiQuickOpen] = useState(false);

  useEffect(() => {
    const q = search.trim();
    let cancelled = false;
    const h = setTimeout(() => {
      if (!q) {
        setResults([]);
        return;
      }
      searchPurchaseReturnProducts(q, warehouseId)
        .then((rows) => {
          if (!cancelled) setResults(rows.filter((row) => !lines.some((line) => line.productId === row.id)));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [search, warehouseId, lines]);

  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.returnUnitCost, 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = Math.round((afterDiscount * vatRate) / 100);
  const totalRefund = afterDiscount + tax;
  const clampedRefund = Math.min(refundAmount, totalRefund);
  const debtAmount = applyDebt ? Math.max(0, totalRefund - clampedRefund) : 0;
  const unsettled = Math.max(0, totalRefund - clampedRefund - debtAmount);

  function addProduct(product: PurchaseReturnProductRow) {
    setLines((current) => [...current, productToLine(product)]);
    setSearch("");
  }

  async function applyAiPreview(preview: AiActionPreview, applyMode: AiQuickActionApplyMode) {
    const payload = preview.action?.payload && typeof preview.action.payload === "object" ? preview.action.payload as Record<string, unknown> : {};
    const itemRows = Array.isArray(payload.items)
      ? payload.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      : [];
    const lookups = [
      typeof payload.sku === "string" || typeof payload.productName === "string"
        ? { sku: payload.sku, productName: payload.productName, text: payload.text, quantity: payload.quantity, unitCost: payload.unitCost }
        : null,
      ...itemRows,
    ].filter((item): item is Record<string, unknown> => Boolean(item));
    const seen = new Set(applyMode === "replace" ? [] : lines.map((line) => line.productId));
    const nextLines: Line[] = [];

    for (const item of lookups) {
      const query = [item.sku, item.productName, item.text].find((value) => typeof value === "string" && value.trim()) as string | undefined;
      if (!query) continue;
      const matches = await searchPurchaseReturnProducts(query, warehouseId);
      const product = matches.find((row) => row.sku.toLowerCase() === query.toLowerCase()) ?? matches[0];
      if (!product || seen.has(product.id)) continue;
      seen.add(product.id);
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitCost = Number(item.unitCost) || Number(product.costPrice) || 0;
      nextLines.push({ ...productToLine(product), quantity, returnUnitCost: unitCost });
    }

    if (nextLines.length) setLines((current) => applyMode === "replace" ? nextLines : [...current, ...nextLines]);
    else {
      const query = [lookups[0]?.sku, lookups[0]?.productName, lookups[0]?.text].find((value) => typeof value === "string" && value.trim()) as string | undefined;
      if (query) setSearch(query);
    }
  }

  function patch(productId: string, next: Partial<Line>) {
    setLines((current) => current.map((line) => line.productId === productId ? { ...line, ...next } : line));
  }

  async function submit() {
    if (busy || !supplierId || !warehouseId || lines.length === 0) return;
    const invalid = lines.some((line) => line.quantity <= 0 || line.returnUnitCost < 0 || line.quantity > line.stock + 1e-9);
    if (invalid) {
      setError(t("purchaseReturns.errors.insufficientStock"));
      return;
    }
    setBusy(true);
    setError("");
    const res = await createPurchaseReturn({
      supplierId,
      warehouseId,
      discount,
      vatRate,
      refundAmount: clampedRefund,
      refundMethod: clampedRefund > 0 ? refundMethod : null,
      debtAmount,
      note: note || undefined,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        returnUnitCost: line.returnUnitCost,
      })),
    });
    setBusy(false);
    if (res.ok) router.push(`${Routes.Inventory}?tab=purchase-returns&expanded=${res.data.id}`);
    else setError(t(res.error as never));
  }

  const numCls = "no-spinner w-full px-2 py-1.5 text-right text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums";

  return (
    <div className="h-dvh flex flex-col">
      <header className="shrink-0 min-h-12 px-4 flex items-center gap-3 bg-surface border-b border-border">
        <Button type="button" variant="ghost" size="iconSm" onClick={() => router.push(`${Routes.Inventory}?tab=purchase-returns`)} aria-label={t("common.back")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Text as="h1" weight="bold" className="text-[17px]" text={t("purchaseReturns.createTitle")} />
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden bg-canvas">
        <div className="flex-1 min-w-0 min-h-[420px] lg:min-h-0 flex flex-col p-3 sm:p-4">
          <div className="relative mb-3">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("purchaseReturns.searchProduct")} leftIcon={<Search />} className="h-11" />
              </div>
              <AiQuickActionButton onClick={() => setAiQuickOpen(true)} label={t("aiQuick.purchase.open")} className="h-11 w-12" />
            </div>
            {results.length > 0 && <ProductResults rows={results} onPick={addProduct} />}
          </div>

          <div className="flex-1 min-h-[320px] overflow-auto bg-surface border border-border rounded-card">
            <table className="w-full min-w-[820px] table-fixed text-sm">
              <colgroup>
                <col className="w-14" />
                <col className="w-28" />
                <col />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-30" />
                <col className="w-32" />
                <col className="w-14" />
              </colgroup>
              <thead className="sticky top-0 bg-er-soft/60">
                <tr className="text-left text-xs text-slate-700 dark:text-slate-200">
                  <th className="px-3 py-3 font-semibold text-center">{t("purchaseReturns.cols.index")}</th>
                  <th className="px-3 py-3 font-semibold">{t("purchaseReturns.cols.sku")}</th>
                  <th className="px-3 py-3 font-semibold">{t("purchaseReturns.cols.productName")}</th>
                  <th className="px-3 py-3 font-semibold">{t("purchaseReturns.cols.unit")}</th>
                  <th className="px-3 py-3 font-semibold text-right">{t("purchaseReturns.cols.qty")}</th>
                  <th className="px-3 py-3 font-semibold text-right">{t("purchaseReturns.cols.unitCost")}</th>
                  <th className="px-3 py-3 font-semibold text-right">{t("purchaseReturns.cols.returnUnitCost")}</th>
                  <th className="px-3 py-3 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
                  <th className="sticky right-0 bg-er-soft/60" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="h-[420px] text-center text-slate-400">
                      <div className="font-semibold text-slate-700 dark:text-slate-200">{t("purchaseReturns.emptyLinesTitle")}</div>
                      <div className="mt-2 text-sm">{t("purchaseReturns.emptyLinesHint")}</div>
                    </td>
                  </tr>
                ) : lines.map((line, index) => {
                  const overStock = line.quantity > line.stock + 1e-9;
                  return (
                    <tr key={line.productId}>
                      <td className="px-3 py-2 text-center text-slate-500">{index + 1}</td>
                      <td className="px-3 py-2 font-medium text-primary-600">{line.sku}</td>
                      <td className="px-3 py-2">
                        <div className="truncate font-medium">{line.name}</div>
                        <div className={cn("text-xs", overStock ? "text-er" : "text-slate-400")}>
                          {t("purchaseReturns.availableStock", { stock: formatNumber(line.stock), unit: line.unitName })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{line.unitName}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={line.stock}
                          value={line.quantity}
                          onChange={(event) => patch(line.productId, { quantity: Math.max(0, Number(event.target.value)) })}
                          className={cn(numCls, overStock && "border-er text-er")}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatCurrency(line.unitCost)}</td>
                      <td className="px-3 py-2">
                        <MoneyInput value={line.returnUnitCost} onChange={(value) => patch(line.productId, { returnUnitCost: value ?? 0 })} className={numCls} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(line.quantity * line.returnUnitCost)}</td>
                      <td className="sticky right-0 bg-surface px-3 py-2 text-right shadow-[-10px_0_18px_rgba(15,23,42,0.04)]">
                        <Button type="button" variant="ghost" size="iconSm" aria-label={t("common.delete")} onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))} className="text-slate-400 hover:text-er">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="w-full lg:w-[390px] shrink-0 bg-surface border-t lg:border-t-0 lg:border-l border-border flex flex-col p-3 sm:p-4 gap-3 overflow-auto">
          <div className="grid grid-cols-2 gap-2">
            <Combobox value={warehouseId} onChange={setWarehouseId} allowClear={false} options={options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
            <Input value={new Date().toLocaleDateString("vi-VN")} readOnly className="text-slate-500" />
          </div>

          <Combobox
            value={supplierId}
            onChange={setSupplierId}
            allowClear={false}
            placeholder={t("purchaseReturns.supplierPlaceholder")}
            options={options.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
          />

          <div className="space-y-2 pt-2 text-sm">
            <SummaryLine label={t("purchaseReturns.code")} value={t("purchaseReturns.autoCode")} />
            <SummaryLine label={t("orders.cols.status")} value={t("purchaseReturns.status.draft")} />
            <SummaryLine label={t("purchaseReturns.cols.subtotal")} value={formatCurrency(subtotal)} />
            <div className="flex justify-between items-center gap-2">
              <span className="text-slate-500">{t("purchaseReturns.cols.discount")}</span>
              <MoneyInput value={discount || ""} placeholder="0" onChange={(value) => setDiscount(value ?? 0)} className={cn(numCls, "w-36")} />
            </div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-slate-500">{t("purchaseReturns.vatRefund")}</span>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={100} value={vatRate || ""} placeholder="0" onChange={(event) => setVatRate(Math.min(100, Math.max(0, Number(event.target.value))))} className={cn(numCls, "w-16")} />
                <span className="tabular-nums text-slate-500 w-24 text-right">{formatCurrency(tax)}</span>
              </div>
            </div>
            <SummaryLine label={t("purchaseReturns.supplierNeedReturn")} value={formatCurrency(totalRefund)} strong tone="er" />
            <div className="flex justify-between items-center gap-2">
              <div>
                <div className="text-slate-500">{t("purchaseReturns.refundAmount")}</div>
                <Select
                  size="sm"
                  value={refundMethod}
                  onChange={(event) => setRefundMethod(event.target.value as "cash" | "bank_transfer")}
                  options={[
                    { value: "cash", label: t("purchaseReturns.refundMethods.cash") },
                    { value: "bank_transfer", label: t("purchaseReturns.refundMethods.bank_transfer") },
                  ]}
                  className="mt-1 w-36"
                />
              </div>
              <MoneyInput value={refundAmount || ""} placeholder="0" onChange={(value) => setRefundAmount(value ?? 0)} className={cn(numCls, "w-36")} />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border-soft px-3 py-2">
              <span className="text-slate-600 dark:text-slate-300">{t("purchaseReturns.applyDebt")}</span>
              <input type="checkbox" checked={applyDebt} onChange={(event) => setApplyDebt(event.target.checked)} className="rounded text-primary-600" />
            </label>
            <SummaryLine label={t("purchaseReturns.debtAmount")} value={formatCurrency(debtAmount)} />
            {unsettled > 0 && <SummaryLine label={t("purchaseReturns.unsettledAmount")} value={formatCurrency(unsettled)} tone="warn" />}
          </div>

          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("orders.detail.notePlaceholder")} rows={3} className="resize-none" />
          {error && <Text as="p" variant="destructive" text={error} />}

          <div className="mt-auto grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" disabled title={t("purchaseReturns.draftTodo")} className="h-12 rounded-card font-semibold">
              {t("purchaseReturns.saveDraft")}
            </Button>
            <Button type="button" onClick={submit} disabled={lines.length === 0 || !supplierId || !warehouseId} loading={busy} className="h-12 rounded-card font-semibold">
              {t("purchaseReturns.complete")}
            </Button>
          </div>
        </aside>
      </div>

      <AiQuickActionModal
        open={aiQuickOpen}
        title={t("aiQuick.purchase.title")}
        description={t("aiQuick.purchase.description")}
        placeholder={t("aiQuick.purchase.placeholder")}
        submitLabel={t("aiQuick.purchase.submit")}
        applyLabel={t("aiQuick.purchase.apply")}
        preset="create_inventory_inbound"
        surface="web"
        acceptedIntents={["create_inventory_inbound", "create_draft_purchase_order", "create_draft_purchase_order_from_restocking"]}
        hasExistingData={lines.length > 0}
        existingDataLabel={t("aiQuick.purchase.existingData")}
        onClose={() => setAiQuickOpen(false)}
        onApply={applyAiPreview}
      />
    </div>
  );
}

function ProductResults({ rows, onPick }: { rows: PurchaseReturnProductRow[]; onPick: (row: PurchaseReturnProductRow) => void }) {
  return (
    <div className="absolute z-20 left-0 right-14 mt-1 max-h-80 overflow-auto bg-surface border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
      {rows.map((row) => (
        <button key={row.id} type="button" onClick={() => onPick(row)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{row.name}</span>
            <span className="block truncate text-xs text-slate-400">{row.sku}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatNumber(Number(row.totalStock))} {row.baseUnit}</span>
        </button>
      ))}
    </div>
  );
}

function SummaryLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "er" | "warn" }) {
  return (
    <div className={cn("flex justify-between items-center gap-3", strong && "text-base font-semibold")}>
      <span className="text-slate-500">{label}</span>
      <span className={cn("tabular-nums text-right", strong && "font-semibold", tone === "er" && "text-er", tone === "warn" && "text-warn")}>{value}</span>
    </div>
  );
}
