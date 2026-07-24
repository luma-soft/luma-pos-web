"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { Combobox } from "@/components/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { AiQuickActionButton } from "@/components/ai-quick-actions/ai-quick-action-button";
import { AiQuickActionModal } from "@/components/ai-quick-actions/ai-quick-action-modal";
import type { AiQuickActionApplyMode } from "@/components/ai-quick-actions/types";
import { createPurchase, updatePurchase } from "@/lib/actions/purchases";
import { resolvePurchaseDraftProducts } from "@/lib/actions/purchase-search";
import type { PurchaseFormOptions, PurchaseProductRow } from "@/lib/data/inventory";
import type { AiActionPreview } from "@/lib/ai/actions";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY } from "@/components/ai-assistant/utils";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { catalogItemToPurchaseProduct } from "@/lib/inventory/product-catalog-adapter";

type PUnit = { unitName: string; multiplier: number };
type Line = {
  productId: string; name: string; sku: string;
  baseUnit: string; baseCost: number; units: PUnit[];
  unitName: string; multiplier: number; // đơn vị đang chọn
  quantity: number; unitCost: number;   // theo đơn vị đang chọn
  discInput: number; discMode: "vnd" | "pct"; // giảm giá dòng
};

type AiWorkflowDraft = {
  previewId?: string;
  intent?: string;
  entityType?: string;
  action?: { type?: string; target?: string; payload?: Record<string, unknown> };
  fields?: { label: string; value: string; meta?: string; tone?: "default" | "warning" | "danger" | "success" }[];
  lines?: { label?: string; value?: string; meta?: string }[];
  warnings?: string[];
};

type AiDraftProductLookup = {
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  text?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  discount?: number | null;
};

type AiPendingLine = {
  key: string;
  label: string;
  sku?: string;
  meta?: string;
};

function uniquePendingLines(lines: AiPendingLine[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${line.sku ?? ""}:${line.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skuFromText(value: string) {
  return value.match(/\b[A-Z]{1,6}\d[A-Z0-9._-]{2,}\b/i)?.[0]?.toUpperCase();
}

function pendingLinesFromAiDraft(draft: AiWorkflowDraft) {
  const fromLines = (draft.lines ?? [])
    .filter((line) => line.value === "Cần chọn lại")
    .map((line, index) => {
      const meta = typeof line.meta === "string" ? line.meta : "";
      const label = typeof line.label === "string" && line.label.trim() ? line.label.trim() : `Dòng ${index + 1}`;
      return {
        key: `line-${index}`,
        label,
        sku: skuFromText(meta),
        meta,
      };
    });
  const fromWarnings = (draft.warnings ?? [])
    .flatMap((warning, index) => {
      const match = warning.match(/Cần kiểm tra dòng:\s*(.+)$/i);
      if (!match) return [];
      const raw = match[1].trim();
      const parts = raw.split("·").map((part) => part.trim()).filter(Boolean);
      const sku = skuFromText(parts[0] ?? raw);
      return [{
        key: `warning-${index}`,
        label: parts.slice(sku ? 1 : 0).join(" · ") || raw,
        sku,
        meta: raw,
      }];
    });
  return uniquePendingLines([...fromLines, ...fromWarnings]);
}

function objectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function draftLookupFromRow(row: Record<string, unknown>): AiDraftProductLookup {
  return {
    productId: typeof row.productId === "string" ? row.productId : null,
    productName: typeof row.productName === "string" ? row.productName : null,
    sku: typeof row.sku === "string" ? row.sku : null,
    text: typeof row.text === "string" ? row.text : null,
    quantity: Number(row.quantity) || null,
    unitCost: Number(row.unitCost) || null,
    discount: Number(row.discount) || null,
  };
}

function draftLookupFromPending(line: AiPendingLine): AiDraftProductLookup {
  return {
    sku: line.sku ?? null,
    productName: line.label,
    text: line.meta ?? line.label,
    quantity: 1,
    unitCost: null,
    discount: 0,
  };
}

export type PurchaseFormInitialValues = {
  supplierId: string;
  warehouseId: string;
  discount: number;
  vatRate: number;
  invoiceNumber: string;
  amountPaid: number;
  note: string;
  items: {
    productId: string;
    quantity: number;
    unitCost: number;
    discount: number;
  }[];
};

function productToLine(
  p: PurchaseProductRow,
  seed?: PurchaseFormInitialValues["items"][number]
): Line {
  const baseCost = Number(p.costPrice) || 0;
  const units: PUnit[] = (p.units ?? []).map((u) => ({ unitName: u.unitName, multiplier: Number(u.multiplier) || 1 }));
  return {
    productId: p.id,
    name: p.name,
    sku: p.sku,
    baseUnit: p.baseUnit,
    baseCost,
    units,
    unitName: p.baseUnit,
    multiplier: 1,
    quantity: seed?.quantity ?? 1,
    unitCost: seed?.unitCost ?? baseCost,
    discInput: seed?.discount ?? 0,
    discMode: "vnd",
  };
}

export function PurchaseForm({
  options,
  initialProducts = [],
  initialValues,
  mode = "create",
  purchaseId,
  purchaseCode,
  aiPreview = false,
}: {
  options: PurchaseFormOptions;
  initialProducts?: PurchaseProductRow[];
  initialValues?: PurchaseFormInitialValues;
  mode?: "create" | "copy" | "edit";
  purchaseId?: string;
  purchaseCode?: string;
  aiPreview?: boolean;
}) {
  const catalog = useProductCatalog();
  const t = useTranslations();
  const router = useRouter();

  const [supplierId, setSupplierId] = useState(initialValues?.supplierId ?? options.suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(initialValues?.warehouseId ?? options.warehouses[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(() => {
    if (!initialValues) return initialProducts.map((p) => productToLine(p));
    const byId = new Map(initialProducts.map((p) => [p.id, p]));
    return initialValues.items.flatMap((item) => {
      const product = byId.get(item.productId);
      return product ? [productToLine(product, item)] : [];
    });
  });
  const [search, setSearch] = useState("");
  const [discount, setDiscount] = useState(initialValues?.discount ?? 0);
  const [vatRate, setVatRate] = useState(initialValues?.vatRate ?? 0);
  const [invoiceNumber, setInvoiceNumber] = useState(initialValues?.invoiceNumber ?? "");
  const [amountPaid, setAmountPaid] = useState(initialValues?.amountPaid ?? 0);
  const [payFull, setPayFull] = useState(false);
  const [note, setNote] = useState(initialValues?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiPendingLines, setAiPendingLines] = useState<AiPendingLine[]>([]);
  const [aiQuickOpen, setAiQuickOpen] = useState(false);
  const aiPreviewHydratedRef = useRef(false);

  useEffect(() => {
    if (mode !== "create" || !aiPreview) return;
    if (aiPreviewHydratedRef.current) return;
    aiPreviewHydratedRef.current = true;
    let cancelled = false;

    async function hydrateAiDraft() {
      const raw = window.localStorage.getItem(AI_WORKFLOW_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as AiWorkflowDraft;
      if (cancelled) return;
      const action = {
        type: typeof draft.action?.type === "string" ? draft.action.type : "",
        target: typeof draft.action?.target === "string" ? draft.action.target : "",
        payload: draft.action?.payload ?? {},
      };
      await applyAiPreview({
        id: draft.previewId ?? "stored-ai-draft",
        intent: draft.intent ?? "",
        title: "",
        description: "",
        confidence: 0,
        state: "preview",
        confirmationRequired: true,
        entityType: draft.entityType ?? "purchase_order",
        requiredFields: [],
        missingFields: [],
        fields: draft.fields ?? [],
        lines: (draft.lines ?? []).flatMap((line) => typeof line.label === "string" && typeof line.value === "string" ? [{
          label: line.label,
          value: line.value,
          meta: line.meta,
        }] : []),
        warnings: draft.warnings ?? [],
        action,
      }, "replace");
    }

    hydrateAiDraft().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPreview, mode]);

  async function applyAiPreview(preview: AiActionPreview, applyMode: AiQuickActionApplyMode) {
    if (preview.intent !== "create_inventory_inbound" && preview.intent !== "create_draft_purchase_order" && preview.intent !== "create_draft_purchase_order_from_restocking") return;
    const draft: AiWorkflowDraft = {
      intent: preview.intent,
      action: preview.action,
      lines: preview.lines,
      warnings: preview.warnings,
    };
    const payload = draft.action?.payload ?? {};
    const pendingLines = pendingLinesFromAiDraft(draft);
    const itemRows = objectRows(payload.items);
    const unresolvedRows = objectRows(payload.unresolvedItems);
    const singleProductRow = typeof payload.productId === "string"
      ? [{
          productId: payload.productId,
          productName: typeof payload.productName === "string" ? payload.productName : null,
          sku: typeof payload.sku === "string" ? payload.sku : null,
          quantity: Number(payload.quantity) || 1,
          unitCost: Number(payload.unitCost) || 0,
          discount: 0,
        }]
      : [];
    const draftItems = [
      ...singleProductRow,
      ...itemRows.map(draftLookupFromRow),
      ...unresolvedRows.map(draftLookupFromRow),
      ...pendingLines.map(draftLookupFromPending),
    ];
    const resolutions = await resolvePurchaseDraftProducts(draftItems);
    const seenProducts = new Set<string>();
    const nextLines = resolutions.flatMap((resolution) => {
      if (!resolution.product || seenProducts.has(resolution.product.id)) return [];
      seenProducts.add(resolution.product.id);
      return [productToLine(resolution.product, resolution.seed)];
    });
    const unresolvedPending = uniquePendingLines(resolutions.flatMap((resolution) => resolution.pending ? [resolution.pending] : []));
    const supplierIdDraft = typeof payload.supplierId === "string" ? payload.supplierId : "";
    const warehouseIdDraft = typeof payload.warehouseId === "string" ? payload.warehouseId : "";

    if (supplierIdDraft && options.suppliers.some((supplier) => supplier.id === supplierIdDraft) && (applyMode === "replace" || !supplierId)) setSupplierId(supplierIdDraft);
    if (warehouseIdDraft && options.warehouses.some((warehouse) => warehouse.id === warehouseIdDraft) && (applyMode === "replace" || !warehouseId)) setWarehouseId(warehouseIdDraft);
    if (nextLines.length) {
      setLines((current) => {
        if (applyMode === "replace") return nextLines;
        const byProduct = new Map(current.map((line) => [line.productId, line]));
        for (const line of nextLines) {
          const existing = byProduct.get(line.productId);
          byProduct.set(line.productId, existing
            ? { ...existing, quantity: existing.quantity + line.quantity, unitCost: line.unitCost || existing.unitCost, discInput: existing.discInput + line.discInput }
            : line);
        }
        return Array.from(byProduct.values());
      });
    }
    setAiPendingLines((current) => applyMode === "replace" ? unresolvedPending : uniquePendingLines([...current, ...unresolvedPending]));
    if (!nextLines.length && unresolvedPending[0]) setSearch(unresolvedPending[0].sku ?? unresolvedPending[0].label);
    if (typeof payload.discount === "number" && (applyMode === "replace" || discount === 0)) setDiscount(payload.discount);
    if (typeof payload.vatRate === "number" && (applyMode === "replace" || vatRate === 0)) setVatRate(payload.vatRate);
    if (typeof payload.invoiceNumber === "string" && (applyMode === "replace" || !invoiceNumber)) setInvoiceNumber(payload.invoiceNumber);
    if (typeof payload.amountPaid === "number" && (applyMode === "replace" || amountPaid === 0)) setAmountPaid(payload.amountPaid);
    if (typeof payload.note === "string" && (applyMode === "replace" || !note)) setNote(payload.note);
  }

  // Tìm trong Product Catalog chung; online/offline dùng cùng một interface.
  const [results, setResults] = useState<PurchaseProductRow[]>([]);
  useEffect(() => {
    const q = search.trim();
    let cancelled = false;
    const h = setTimeout(() => {
      if (cancelled) return;
      if (!q) { setResults([]); return; }
      const rows = catalog.search(q, {
        stockManagedOnly: true,
        excludeIds: new Set(lines.map((line) => line.productId)),
        limit: 30,
      }).map(catalogItemToPurchaseProduct);
      if (!cancelled) setResults(rows);
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(h); };
  }, [catalog, search, lines]);

  const lineDiscountVnd = (l: Line) =>
    l.discMode === "pct" ? Math.round((l.quantity * l.unitCost * l.discInput) / 100) : l.discInput;
  const lineTotal = (l: Line) => Math.max(0, l.quantity * l.unitCost - lineDiscountVnd(l));
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = Math.round((afterDiscount * vatRate) / 100);
  const total = afterDiscount + tax;
  const paid = payFull ? total : Math.min(amountPaid, total);
  const owed = total - paid;

  function addProduct(p: PurchaseProductRow) {
    setLines((ls) => [...ls, productToLine(p)]);
    setAiPendingLines((rows) => rows.filter((row) => row.sku !== p.sku && row.label !== p.name));
    setSearch("");
  }
  function patch(id: string, p: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, ...p } : l)));
  }
  /** Đổi đơn vị tính: cập nhật hệ số + giá nhập theo đơn vị mới (= giá vốn gốc × hệ số). */
  function changeUnit(id: string, unitName: string) {
    setLines((ls) => ls.map((l) => {
      if (l.productId !== id) return l;
      const mult = unitName === l.baseUnit ? 1 : (l.units.find((u) => u.unitName === unitName)?.multiplier ?? 1);
      return { ...l, unitName, multiplier: mult, unitCost: Math.round(l.baseCost * mult) };
    }));
  }

  async function submit() {
    if (!supplierId || !warehouseId || lines.length === 0 || busy) return;
    setBusy(true); setError("");
    const payload = {
      supplierId, warehouseId,
      discount, vatRate,
      invoiceNumber: invoiceNumber || undefined,
      note: note || undefined,
      amountPaid: paid,
      // quy về đơn vị gốc cho action (SL gốc = SL×hệ số; giá vốn/đơn vị gốc = giá nhập/hệ số)
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity * l.multiplier,
        unitCost: l.multiplier > 0 ? l.unitCost / l.multiplier : l.unitCost,
        discount: lineDiscountVnd(l),
      })),
    };

    if (mode === "edit" && purchaseId) {
      const res = await updatePurchase({ id: purchaseId, ...payload });
      setBusy(false);
      if (res.ok) {
        void catalog.refresh();
        router.push(Routes.purchase(purchaseId));
      }
      else setError(t(res.error as never));
      return;
    }

    const res = await createPurchase(payload);
    setBusy(false);
    if (res.ok) {
      void catalog.refresh();
      router.push(Routes.purchase(res.data.id));
    }
    else setError(t(res.error as never));
  }

  const numCls = "no-spinner w-full px-2 py-1.5 text-right text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums";
  const title = mode === "edit"
    ? t("purchases.editTitle", { code: purchaseCode ?? "" })
    : mode === "copy"
      ? t("purchases.copyTitle", { code: purchaseCode ?? "" })
      : t("purchases.createNew");
  const backHref = mode === "edit" && purchaseId ? Routes.purchase(purchaseId) : Routes.Purchases;
  const defaultSupplierId = initialValues?.supplierId ?? options.suppliers[0]?.id ?? "";
  const defaultWarehouseId = initialValues?.warehouseId ?? options.warehouses[0]?.id ?? "";
  const hasAiMergeRisk =
    lines.length > 0 ||
    aiPendingLines.length > 0 ||
    supplierId !== defaultSupplierId ||
    warehouseId !== defaultWarehouseId ||
    discount !== (initialValues?.discount ?? 0) ||
    vatRate !== (initialValues?.vatRate ?? 0) ||
    invoiceNumber !== (initialValues?.invoiceNumber ?? "") ||
    amountPaid !== (initialValues?.amountPaid ?? 0) ||
    note !== (initialValues?.note ?? "");

  return (
    <div className="h-dvh flex flex-col">
      <header className="shrink-0 h-12 px-4 flex items-center gap-3 bg-surface border-b border-border">
        <Button type="button" variant="ghost" size="iconSm" onClick={() => router.push(backHref)} aria-label={t("common.back")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Text as="h1" weight="bold" text={title} />
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-auto lg:overflow-hidden">
        {/* trái: tìm + bảng hàng */}
        <div className="flex-1 min-w-0 min-h-[420px] lg:min-h-0 flex flex-col p-3 sm:p-4">
          <div className="relative mb-3">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("purchases.searchProduct")} leftIcon={<Search />} className="h-11" />
              </div>
              {mode === "create" && (
                <AiQuickActionButton
                  onClick={() => setAiQuickOpen(true)}
                  label={t("aiQuick.purchase.open")}
                  className="h-11 w-12"
                />
              )}
            </div>
            {results.length > 0 && (
              <div className="absolute z-20 left-0 right-14 mt-1 max-h-80 overflow-auto bg-surface border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                {results.map((p) => (
                  <Button key={p.id} type="button" variant="ghost" block onClick={() => addProduct(p)} className="h-auto justify-between rounded-none px-3 py-2 text-left">
                    <Text as="span" className="min-w-0 text-current">
                      <Text as="span" weight="medium" text={p.name} />
                      <Text as="span" variant="muted" size="xs" className="ml-1" text={p.sku} />
                    </Text>
                    <Text as="span" variant="muted" size="xs" className="shrink-0 tabular-nums" text={formatCurrency(Number(p.costPrice))} />
                  </Button>
                ))}
              </div>
            )}
          </div>
          {aiPendingLines.length > 0 && (
            <div className="mb-3 rounded-card border border-warn/25 bg-warn-soft p-3 text-warn">
              <div className="text-xs font-bold">AI chưa tìm thấy sản phẩm trong danh mục active</div>
              <div className="mt-1 text-xs text-warn/80">
                Những dòng này chưa được thêm vào phiếu nhập. Kiểm tra SKU/tên sản phẩm hoặc tạo lại sản phẩm active trước khi nhận hàng.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {aiPendingLines.map((line) => (
                  <button
                    key={line.key}
                    type="button"
                    onClick={() => setSearch(line.sku ?? line.label)}
                    className="max-w-full rounded-full border border-warn/30 bg-surface px-3 py-1.5 text-left text-xs font-semibold text-warn hover:bg-warn-soft"
                    title={line.meta ?? line.label}
                  >
                    <span className="block max-w-[360px] truncate">
                      {line.sku ? `${line.sku} · ` : ""}{line.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 min-h-[280px] overflow-auto bg-surface border border-border rounded-card">
            {lines.length === 0 ? (
              <Text as="div" variant="muted" className="h-full grid place-items-center" text={t("purchases.pickProduct")} />
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
                  <tr className="text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                    <th className="px-2 py-2.5 font-semibold w-28">{t("products.fields.baseUnit")}</th>
                    <th className="px-2 py-2.5 font-semibold text-right w-20">{t("purchases.cols.qty")}</th>
                    <th className="px-2 py-2.5 font-semibold text-right w-28">{t("purchases.cols.unitCost")}</th>
                    <th className="px-2 py-2.5 font-semibold text-right w-36">{t("orders.cols.discount")}</th>
                    <th className="px-3 py-2.5 font-semibold text-right w-32">{t("orders.cols.lineTotal")}</th>
                    <th className="w-9"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {lines.map((l) => (
                    <tr key={l.productId}>
                      <td className="px-3 py-2"><div className="font-medium">{l.name}</div><div className="text-xs text-slate-400">{l.sku}</div></td>
                      <td className="px-2 py-2">
                        <Select
                          size="sm"
                          value={l.unitName}
                          onChange={(e) => changeUnit(l.productId, e.target.value)}
                          options={[
                            { value: l.baseUnit, label: l.baseUnit },
                            ...l.units.map((u) => ({ value: u.unitName, label: `${u.unitName} (×${u.multiplier})` })),
                          ]}
                        />
                      </td>
                      <td className="px-2 py-2"><input type="number" min={0} value={l.quantity} onChange={(e) => patch(l.productId, { quantity: Math.max(0, Number(e.target.value)) })} className={numCls} /></td>
                      <td className="px-2 py-2"><MoneyInput value={l.unitCost} onChange={(v) => patch(l.productId, { unitCost: v ?? 0 })} className={numCls} /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} value={l.discInput || ""} placeholder="0" onChange={(e) => patch(l.productId, { discInput: Math.max(0, Number(e.target.value)) })} className={numCls} />
                          <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
                            {(["vnd", "pct"] as const).map((m) => (
                              <Button
                                key={m}
                                type="button"
                                onClick={() => patch(l.productId, { discMode: m })}
                                variant={l.discMode === m ? "default" : "ghost"}
                                size="sm"
                                className="h-8 rounded-none px-2 text-[11px] font-semibold"
                              >
                                {m === "vnd" ? "đ" : "%"}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(lineTotal(l))}</td>
                      <td className="px-2 py-2 text-right">
                        <Button type="button" variant="ghost" size="iconSm" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* phải: NCC + tổng tiền */}
        <div className="w-full lg:w-[380px] shrink-0 bg-surface border-t lg:border-t-0 lg:border-l border-border flex flex-col p-3 sm:p-4 gap-3 overflow-auto">
          <div>
            <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={`${t("purchases.cols.supplier")} *`} />
            <Combobox value={supplierId} onChange={setSupplierId} allowClear={false}
              placeholder={t("purchases.noSuppliers")}
              options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div>
            <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={t("purchases.cols.warehouse")} />
            <Combobox value={warehouseId} onChange={setWarehouseId} allowClear={false}
              options={options.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </div>
          <div>
            <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={t("purchases.invoiceNumber")} />
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder={t("purchases.invoiceNumberPlaceholder")} />
          </div>

          <div className="mt-1 pt-3 border-t border-border space-y-2.5 text-sm">
            <div className="flex justify-between items-center"><span className="text-slate-500">{t("purchases.subtotal")} ({lines.length})</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between items-center gap-2"><span className="text-slate-500">{t("pos.discount")}</span><MoneyInput value={discount || ""} placeholder="0" onChange={(v) => setDiscount(v ?? 0)} className={cn(numCls, "w-32")} /></div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-slate-500">VAT %</span>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={100} value={vatRate || ""} placeholder="0" onChange={(e) => setVatRate(Math.min(100, Math.max(0, Number(e.target.value))))} className={cn(numCls, "w-16")} />
                <span className="tabular-nums text-slate-500 w-24 text-right">{formatCurrency(tax)}</span>
              </div>
            </div>
            <div className="flex justify-between items-center text-base font-semibold pt-1"><span>{t("purchases.needPay")}</span><span className="text-primary-600 tabular-nums">{formatCurrency(total)}</span></div>

            <label className="flex items-center gap-2 text-sm pt-1"><input type="checkbox" checked={payFull} onChange={(e) => setPayFull(e.target.checked)} className="rounded text-primary-600" />{t("purchases.payFull")}</label>
            {!payFull && (
              <div className="flex justify-between items-center gap-2"><span className="text-slate-500">{t("purchases.amountPaid")}</span><MoneyInput value={amountPaid || ""} placeholder="0" onChange={(v) => setAmountPaid(v ?? 0)} className={cn(numCls, "w-36")} /></div>
            )}
            <div className="flex justify-between items-center"><span className="text-slate-500">{t("purchases.cols.owed")}</span><span className={cn("tabular-nums font-semibold", owed > 0 ? "text-warn" : "text-slate-400")}>{formatCurrency(owed)}</span></div>
          </div>

          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("orders.detail.notePlaceholder")} rows={2} className="resize-none" />

          {error && <Text as="p" variant="destructive" text={error} />}

          <Button type="button" onClick={submit} disabled={lines.length === 0 || !supplierId} loading={busy} block className="mt-auto h-12 rounded-card font-semibold">
            {mode === "edit" ? t("purchases.saveChanges") : t("purchases.receiveNow")} · {formatCurrency(total)}
          </Button>
          <Text as="p" variant="muted" className="text-[11px]" text={t("purchases.receiveHint")} />
        </div>
      </div>

      {mode === "create" && (
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
          hasExistingData={hasAiMergeRisk}
          existingDataLabel={t("aiQuick.purchase.existingData")}
          onClose={() => setAiQuickOpen(false)}
          onApply={applyAiPreview}
        />
      )}
    </div>
  );
}
