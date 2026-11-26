"use client";

import { DocumentTimeField, documentTimeDate } from "@/components/document-time-field";
import { productDisplayName } from "@/lib/products/variant-presentation";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalCloseLink } from "@/components/ui/modal-close-link";
import { useReturnAfterSave } from "@/components/use-return-after-save";
import { useTranslations } from "next-intl";
import { Plus, Search, Trash2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { MobileFormLineCard, TouchTargetToggle } from "@/components/mobile-ui";
import { cn, formatCurrency } from "@/lib/utils";
import { Combobox } from "@/components/combobox";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { AiQuickActionButton } from "@/components/ai-quick-actions/ai-quick-action-button";
import { AiQuickActionModal } from "@/components/ai-quick-actions/ai-quick-action-modal";
import type { AiQuickActionApplyMode } from "@/components/ai-quick-actions/types";
import { createPurchase, savePurchaseDraft, updatePurchase } from "@/lib/actions/purchases";
import { resolvePurchaseDraftProducts } from "@/lib/actions/purchase-search";
import type { PurchaseFormOptions, PurchaseProductRow } from "@/lib/data/inventory";
import type { AiActionPreview } from "@/lib/ai/actions";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY, tenantStorageKey } from "@/components/ai-assistant/utils";
import { useTenantClientScope } from "@/components/tenant-client-scope";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { catalogItemToPurchaseProduct } from "@/lib/inventory/product-catalog-adapter";
import { getCatalogWarehouseStock } from "@/lib/product-catalog";
import {
  purchaseLineDiscount,
  purchaseLineTotal,
  purchaseUnitCostFromTotal,
} from "@/lib/purchases/line-calculations";
import { ProductSearchPicker } from "@/components/product-search/product-search-picker";
import { ProductSearchResultLayout, ProductSearchStockLabel, productSearchMetaClass, productSearchNameClass, productSearchPriceClass } from "@/components/product-search/product-search-layout";
import { ProductSearchThumbnail } from "@/components/product-search/product-search-thumbnail";
import { setSelectedProductQuantity } from "@/components/product-search/product-search-state";
import { expandProductSearchUnitResults, rankProductSearchUnitResults } from "@/lib/pos/search-unit-results";
import { ProductCreateMenu, type ProductKind } from "@/app/(app)/inventory/tabs/product-create-menu";
import { SupplierCreateDialog } from "@/components/partners/supplier-create-dialog";

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
  unitName?: string | null;
  unitMultiplier?: number | null;
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
    unitName: typeof row.unitName === "string" ? row.unitName : null,
    unitMultiplier: Number(row.unitMultiplier) || null,
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
    unitName: null,
    unitMultiplier: null,
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
  shippingFee?: number;
  invoiceNumber: string;
  amountPaid: number;
  note: string;
  /** Formatted current document time, shown while the time is left unchanged. */
  occurredAtLabel?: string;
  items: {
    productId: string;
    quantity: number;
    unitCost: number;
    discount: number;
    discountMode?: "vnd" | "pct" | null;
    discountInput?: number | null;
    unitName?: string | null;
    unitMultiplier?: number | null;
  }[];
};

function productToLine(
  p: PurchaseProductRow,
  seed?: PurchaseFormInitialValues["items"][number]
): Line {
  // Start from the latest receipt gross price; average cost is only a fallback.
  const baseCost = Number(p.lastPurchasePrice ?? p.costPrice) || 0;
  const units: PUnit[] = (p.units ?? []).map((u) => ({ unitName: u.unitName, multiplier: Number(u.multiplier) || 1 }));
  const multiplier = Number(seed?.unitMultiplier) > 0 ? Number(seed?.unitMultiplier) : 1;
  const unitName = seed?.unitName || p.baseUnit;
  return {
    productId: p.id,
    name: productDisplayName(p),
    sku: p.sku,
    baseUnit: p.baseUnit,
    baseCost,
    units,
    unitName,
    multiplier,
    quantity: seed?.quantity ?? 1,
    unitCost: seed?.unitCost ?? Math.round(baseCost * multiplier),
    discInput: seed?.discountInput ?? seed?.discount ?? 0,
    discMode: seed?.discountMode ?? "vnd",
  };
}

function withPurchaseLineUnit(line: Line, unitName: string): Line {
  const multiplier = unitName === line.baseUnit
    ? 1
    : line.units.find((unit) => unit.unitName === unitName)?.multiplier ?? 1;
  if (multiplier === line.multiplier) return { ...line, unitName };
  const oldMultiplier = line.multiplier > 0 ? line.multiplier : 1;
  return {
    ...line,
    unitName,
    multiplier,
    quantity: Math.round((line.quantity * oldMultiplier / multiplier) * 10_000) / 10_000,
    unitCost: Math.round((line.unitCost / oldMultiplier) * multiplier),
  };
}

export function PurchaseForm({
  options,
  initialProducts = [],
  initialValues,
  mode = "create",
  purchaseId,
  purchaseCode,
  purchaseStatus,
  createdProductId,
  aiPreview = false,
}: {
  options: PurchaseFormOptions;
  initialProducts?: PurchaseProductRow[];
  initialValues?: PurchaseFormInitialValues;
  mode?: "create" | "copy" | "edit";
  purchaseId?: string;
  purchaseCode?: string;
  purchaseStatus?: "draft" | "received";
  createdProductId?: string;
  aiPreview?: boolean;
  canEditCompanyPrices?: boolean;
}) {
  const storageScope = useTenantClientScope();
  const catalog = useProductCatalog();
  const t = useTranslations();
  const router = useRouter();
  const returnAfterSave = useReturnAfterSave();

  const [supplierId, setSupplierId] = useState(initialValues?.supplierId ?? "");
  const [createdSuppliers, setCreatedSuppliers] = useState<PurchaseFormOptions["suppliers"]>([]);
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
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
  const [shippingFee, setShippingFee] = useState(initialValues?.shippingFee ?? 0);
  const [invoiceNumber, setInvoiceNumber] = useState(initialValues?.invoiceNumber ?? "");
  const [amountPaid, setAmountPaid] = useState(initialValues?.amountPaid ?? 0);
  const [payFull, setPayFull] = useState(false);
  const [note, setNote] = useState(initialValues?.note ?? "");
  const [occurredAt, setOccurredAt] = useState("");
  const [pendingAction, setPendingAction] = useState<"receive" | "draft" | null>(null);
  const [savedReceipt, setSavedReceipt] = useState<{ href: string; code: string; isDraft: boolean } | null>(null);
  // Phones follow the iOS receiving flow: pick items first, then payment.
  const [mobileStep, setMobileStep] = useState<"items" | "payment">("items");
  const submitInFlightRef = useRef(false);
  const busy = pendingAction !== null;
  const [error, setError] = useState("");
  const [aiPendingLines, setAiPendingLines] = useState<AiPendingLine[]>([]);
  const [aiQuickOpen, setAiQuickOpen] = useState(false);
  const aiPreviewHydratedRef = useRef(false);
  const createdProductRefreshRef = useRef<string | null>(null);
  const supplierOptions = useMemo(() => {
    const existingIds = new Set(options.suppliers.map((supplier) => supplier.id));
    return [...options.suppliers, ...createdSuppliers.filter((supplier) => !existingIds.has(supplier.id))];
  }, [createdSuppliers, options.suppliers]);
  const selectedSupplier = supplierOptions.find((supplier) => supplier.id === supplierId);

  useEffect(() => {
    if (mode !== "create" || !createdProductId) return;

    if (createdProductRefreshRef.current !== createdProductId) {
      createdProductRefreshRef.current = createdProductId;
      void catalog.refresh();
    }

    // The server page includes the created product in initialProducts. Add it
    // to the existing draft after the product modal closes, then remove the
    // hand-off query so the refreshed catalog can serve later searches.
    const createdProduct = initialProducts.find((product) => product.id === createdProductId);
    if (!createdProduct) return;

    // Defer the handoff to the next frame, and consume the URL only after
    // the new item has been queued in the draft. This avoids setState inside
    // effect setup without changing the product modal handoff contract.
    const frame = window.requestAnimationFrame(() => {
      setLines((currentLines) => currentLines.some((line) => line.productId === createdProduct.id)
        ? currentLines
        : [productToLine(createdProduct), ...currentLines]);

      const params = new URLSearchParams(window.location.search);
      if (!params.has("createdProductId")) return;
      params.delete("createdProductId");
      const query = params.toString();
      router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, { scroll: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [catalog, createdProductId, initialProducts, mode, router]);

  useEffect(() => {
    if (mode !== "create" || !aiPreview) return;
    if (aiPreviewHydratedRef.current) return;
    aiPreviewHydratedRef.current = true;
    let cancelled = false;

    async function hydrateAiDraft() {
      const raw = window.localStorage.getItem(tenantStorageKey(AI_WORKFLOW_DRAFT_STORAGE_KEY, storageScope));
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
  }, [aiPreview, mode, storageScope]);

  async function applyAiPreview(preview: AiActionPreview, applyMode: AiQuickActionApplyMode) {
    if (preview.intent !== "create_inventory_inbound" && preview.intent !== "create_draft_purchase_order" && preview.intent !== "create_draft_purchase_order_from_restocking") return;
    clearError();
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
          unitName: typeof payload.unitName === "string" ? payload.unitName : null,
          unitMultiplier: Number(payload.unitMultiplier) || null,
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
      const line = productToLine(resolution.product, resolution.seed);
      return [{
        ...line,
        unitName: resolution.seed.unitName || line.unitName,
        multiplier: resolution.seed.multiplier || line.multiplier,
      }];
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
    if (typeof payload.shippingFee === "number" && Number.isFinite(payload.shippingFee) && (applyMode === "replace" || shippingFee === 0)) setShippingFee(Math.max(0, payload.shippingFee));
    if (typeof payload.invoiceNumber === "string" && (applyMode === "replace" || !invoiceNumber)) setInvoiceNumber(payload.invoiceNumber);
    if (typeof payload.amountPaid === "number" && (applyMode === "replace" || amountPaid === 0)) setAmountPaid(payload.amountPaid);
    if (typeof payload.note === "string" && (applyMode === "replace" || !note)) setNote(payload.note);
  }

  const browseProducts = useMemo(
    () => catalog.products.filter((product) => product.isStockManaged),
    [catalog.products],
  );
  const browseSearchResults = useMemo(
    () => expandProductSearchUnitResults(browseProducts),
    [browseProducts],
  );
  const searchProducts = useCallback((query: string) => {
    return rankProductSearchUnitResults(expandProductSearchUnitResults(catalog.search(query, {
      stockManagedOnly: true,
      limit: catalog.products.length,
    })), query, productDisplayName);
  }, [catalog]);

  const subtotal = lines.reduce((s, l) => s + purchaseLineTotal(l), 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = Math.round((afterDiscount * vatRate) / 100);
  const total = afterDiscount + tax + shippingFee;
  const paid = payFull ? total : Math.max(0, amountPaid);
  const owed = total - paid;

  function clearError() {
    setError("");
  }

  function addProduct(p: PurchaseProductRow, unitName = p.baseUnit) {
    clearError();
    const line = productToLine(p);
    const multiplier = unitName === line.baseUnit
      ? 1
      : line.units.find((unit) => unit.unitName === unitName)?.multiplier ?? 1;
    const nextLine = {
      ...line,
      unitName,
      multiplier,
      quantity: 1,
      unitCost: Math.round(line.baseCost * multiplier),
    };
    setLines((ls) => {
      const existing = ls.find((item) => item.productId === p.id);
      return existing
        ? [withPurchaseLineUnit(existing, unitName), ...ls.filter((item) => item.productId !== p.id)]
        : [nextLine, ...ls];
    });
    setAiPendingLines((rows) => rows.filter((row) => row.sku !== p.sku && row.label !== p.name));
    // Keep the query and result popover open so users can add several products
    // from one search. Selected products are excluded by the catalog query.
  }
  function openProductCreator(productKind: ProductKind) {
    const params = new URLSearchParams(window.location.search);
    params.delete("createdProductId");
    const query = params.toString();
    const returnTo = `${window.location.pathname}${query ? `?${query}` : ""}`;
    router.push(Routes.productCreateForReturn(returnTo, productKind), { scroll: false });
  }
  function patch(id: string, p: Partial<Line>) {
    clearError();
    setLines((ls) => p.quantity == null
      ? ls.map((l) => (l.productId === id ? { ...l, ...p } : l))
      : setSelectedProductQuantity(
          ls,
          p.quantity,
          (line) => line.productId === id,
          (line, quantity) => ({ ...line, ...p, quantity }),
        ));
  }
  function patchLineTotal(id: string, desiredTotal: number) {
    clearError();
    setLines((current) => current.map((line) => line.productId === id
      ? { ...line, unitCost: purchaseUnitCostFromTotal(line, desiredTotal) }
      : line));
  }
  /** Đổi đơn vị nhưng giữ nguyên số lượng quy đổi và thành tiền của dòng. */
  function changeUnit(id: string, unitName: string) {
    clearError();
    setLines((ls) => ls.map((line) => line.productId === id ? withPurchaseLineUnit(line, unitName) : line));
  }

  const canSaveDraft = mode !== "edit" || purchaseStatus === "draft";
  const canSubmit = !savedReceipt && Boolean(supplierId && warehouseId && lines.length > 0 && lines.every((line) =>
    Number.isFinite(line.quantity) && line.quantity > 0 &&
    Number.isFinite(line.multiplier) && line.multiplier > 0 &&
    Number.isFinite(line.unitCost) && line.unitCost >= 0
  ));

  async function submit(action: "receive" | "draft" = "receive") {
    if (!canSubmit || busy || submitInFlightRef.current || (action === "draft" && !canSaveDraft)) return;
    submitInFlightRef.current = true;
    setPendingAction(action); setError("");
    const payload = {
      supplierId, warehouseId,
      discount, vatRate, shippingFee,
      invoiceNumber: invoiceNumber || undefined,
      note: note || undefined,
      occurredAt: documentTimeDate(occurredAt),
      amountPaid: action === "draft" ? 0 : paid,
      // quy về đơn vị gốc cho action (SL gốc = SL×hệ số; giá vốn/đơn vị gốc = giá nhập/hệ số)
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity * l.multiplier,
        unitCost: l.multiplier > 0 ? l.unitCost / l.multiplier : l.unitCost,
        discount: purchaseLineDiscount(l),
        discountMode: l.discMode,
        ...(l.discMode === "pct" ? { discountInput: l.discInput } : {}),
      })),
    };

    let savedSuccessfully = false;
    try {
      const res = action === "draft"
        ? await savePurchaseDraft({ ...payload, ...(mode === "edit" && purchaseId ? { id: purchaseId } : {}) })
        : mode === "edit" && purchaseId
          ? await updatePurchase({ id: purchaseId, ...payload })
          : await createPurchase(payload);
      if (res.ok) {
        savedSuccessfully = true;
        if (action === "receive") void catalog.refresh();
        const savedId = mode === "edit" && purchaseId ? purchaseId : "id" in res.data ? res.data.id : undefined;
        const destination = savedId ? Routes.purchaseDetail(savedId) : Routes.Purchases;
        setSavedReceipt({
          href: destination,
          code: "code" in res.data ? res.data.code : purchaseCode ?? "",
          isDraft: action === "draft",
        });
        // Editing returns to the screen that opened the form (e.g. the
        // purchase modal over a filtered list) and refreshes it.
        if (!(mode === "edit" && returnAfterSave())) window.location.assign(destination);
      } else {
        setError(t(res.error as never));
      }
    } catch {
      if (!savedSuccessfully) setError(t("common.error"));
    } finally {
      if (!savedSuccessfully) submitInFlightRef.current = false;
      setPendingAction(null);
    }
  }

  const numCls = "no-spinner min-h-11 w-full px-2 py-1.5 text-right text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums lg:min-h-0";
  const title = mode === "edit"
    ? t("purchases.editTitle", { code: purchaseCode ?? "" })
    : mode === "copy"
      ? t("purchases.copyTitle", { code: purchaseCode ?? "" })
      : t("purchases.createNew");
  const backHref = mode === "edit" && purchaseId ? Routes.purchaseDetail(purchaseId) : Routes.Purchases;
  const defaultSupplierId = initialValues?.supplierId ?? "";
  const defaultWarehouseId = initialValues?.warehouseId ?? options.warehouses[0]?.id ?? "";
  const hasAiMergeRisk =
    lines.length > 0 ||
    aiPendingLines.length > 0 ||
    supplierId !== defaultSupplierId ||
    warehouseId !== defaultWarehouseId ||
    discount !== (initialValues?.discount ?? 0) ||
    vatRate !== (initialValues?.vatRate ?? 0) ||
    shippingFee !== (initialValues?.shippingFee ?? 0) ||
    invoiceNumber !== (initialValues?.invoiceNumber ?? "") ||
    amountPaid !== (initialValues?.amountPaid ?? 0) ||
    occurredAt !== "" ||
    note !== (initialValues?.note ?? "");

  const supplierPicker = (
    <Combobox value={supplierId} onChange={(value) => { clearError(); setSupplierId(value); }} allowClear={false}
      placeholder={t(supplierOptions.length ? "products.fields.supplierPlaceholder" : "purchases.noSuppliers")}
      options={supplierOptions.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
      actionLabel={t("suppliers.createNew")}
      actionIcon={<Plus className="h-4 w-4" />}
      onAction={() => { clearError(); setSupplierCreateOpen(true); }} />
  );
  const supplierDebt = selectedSupplier && (
    <div className="mt-1.5 flex items-center justify-between gap-3 text-xs max-lg:mt-2 max-lg:text-[13px]">
      <span className="text-slate-500 max-lg:text-ios-label-secondary">{t("purchases.currentSupplierDebt")}</span>
      <span className={cn("tabular-nums font-semibold", Number(selectedSupplier.currentDebt) > 0 ? "text-warn" : "text-slate-400")}>
        {formatCurrency(Number(selectedSupplier.currentDebt))}
      </span>
    </div>
  );

  return (
    <div className="min-h-full flex flex-col lg:h-dvh max-lg:bg-canvas">
      {/* Phones: iOS navigation bar — Cancel / Back, centred title per step. */}
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-canvas/85 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl lg:hidden">
        {mobileStep === "payment" ? (
          <button type="button" onClick={() => setMobileStep("items")} className="inline-flex min-h-11 w-20 shrink-0 items-center text-[17px] text-ios-accent">
            {t("common.back")}
          </button>
        ) : (
          <ModalCloseLink href={backHref} anyOpener className="inline-flex min-h-11 w-20 shrink-0 items-center text-[17px] text-ios-accent">
            {t("common.cancel")}
          </ModalCloseLink>
        )}
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">{mobileStep === "payment" ? t("purchases.mobileCompleteTitle") : title}</h1>
        <span className="w-20 shrink-0" aria-hidden="true" />
      </div>
      <MobileDetailHeader
        flush
        backHref={backHref}
        returnToOpener
        backLabel={t("common.back")}
        title={title}
        className="max-lg:hidden"
      />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-visible lg:overflow-hidden">
        {/* trái: tìm + bảng hàng */}
        <div className={cn(
          "flex-1 min-w-0 min-h-[420px] lg:min-h-0 flex flex-col p-3 sm:p-4",
          "max-lg:min-h-0 max-lg:px-ios-inset max-lg:pb-[calc(env(safe-area-inset-bottom)+6.5rem)] max-lg:pt-1",
          mobileStep === "payment" && "max-lg:hidden",
        )}>
          <div className="relative mb-3">
            <div className="flex gap-2">
              <ProductSearchPicker
                query={search}
                onQueryChange={setSearch}
                browseItems={browseSearchResults}
                loadItems={searchProducts}
                itemKey={(result) => `${result.product.id}:${result.unitName ?? "variants"}`}
                onSelect={(result) => addProduct(catalogItemToPurchaseProduct(result.product), result.unitName ?? result.product.baseUnit)}
                isItemSelected={(result) => lines.some((line) =>
                  line.productId === result.product.id && line.unitName === (result.unitName ?? result.product.baseUnit),
                )}
                keepOpenOnSelect
                placeholder={t("purchases.searchProduct")}
                mobileFullScreen={{
                  title: t("mobile.pos.productSearchTitle"),
                  subtitle: t("mobile.pos.productSearchSubtitle"),
                  backLabel: t("common.back"),
                  doneLabel: t("mobile.invoices.selectDone"),
                  selectedCount: lines.length,
                }}
                emptyMessage={t("common.noResults")}
                loadingMessage={t("common.loading")}
                unavailableMessage={t("common.error")}
                closeLabel={t("common.close")}
                catalogStatus={catalog.status === "loading" ? "loading" : catalog.status === "unavailable" ? "unavailable" : "ready"}
                className="flex-1"
                renderItem={(result, { selected }) => {
                  const { product, unitName, alternateUnit } = result;
                  const selectedUnit = unitName ?? product.baseUnit;
                  const line = lines.find((item) => item.productId === product.id);
                  const lineSelected = Boolean(line && line.unitName === selectedUnit);
                  const multiplier = Number(alternateUnit?.multiplier) || 1;
                  const unitCost = Number(product.lastPurchasePrice ?? product.costPrice ?? 0) * multiplier;
                  const warehouse = options.warehouses.find((item) => item.id === warehouseId);
                  const stock = warehouseId
                    ? getCatalogWarehouseStock(product, warehouseId)
                    : product.warehouseStock.reduce((sum, item) => sum + Number(item.quantity), 0);
                  return (
                    <ProductSearchResultLayout
                      selected={selected}
                      leading={<ProductSearchThumbnail product={product} />}
                      summary={(
                        <>
                          <div className={productSearchNameClass}>{productDisplayName(product)} · {selectedUnit}</div>
                          <div className={cn(productSearchMetaClass, "font-mono")}>{product.sku}</div>
                          {product.isStockManaged && <ProductSearchStockLabel
                            quantity={stock}
                            unit={selectedUnit}
                            unitMultiplier={multiplier}
                            label={warehouseId ? t("pos.stockLabel") : t("products.variants.totalStock")}
                            location={warehouse?.name}
                          />}
                        </>
                      )}
                      price={<span className={productSearchPriceClass}>
                          {formatCurrency(unitCost)}/{selectedUnit}
                        </span>}
                      controls={lineSelected && line ? (
                        <div onClick={(event) => event.stopPropagation()}>
                          <QuantityInput
                            size="sm"
                            className="w-[8.25rem] max-lg:w-[124px]"
                            min={0}
                            value={line.quantity}
                            onChange={(quantity) => patch(product.id, { quantity })}
                            inputLabel={t("common.productQuantity", { product: product.name })}
                          />
                        </div>
                      ) : undefined}
                    />
                  );
                }}
              />
              {mode !== "edit" && <ProductCreateMenu
                label={t("purchases.addProduct")}
                showLabel={false}
                onSelect={openProductCreator}
                items={[
                  { kind: "product", label: t("products.kind.labels.product"), hint: t("products.kind.hints.product") },
                  { kind: "service", label: t("products.kind.labels.service"), hint: t("products.kind.hints.service") },
                  { kind: "combo", label: t("products.kind.labels.combo"), hint: t("products.kind.hints.combo") },
                ]}
              />}
              {mode === "create" && (
                <AiQuickActionButton
                  onClick={() => setAiQuickOpen(true)}
                  label={t("aiQuick.purchase.open")}
                  className="h-11 w-11 lg:h-10 lg:w-10 lg:min-h-0 lg:min-w-0"
                />
              )}
            </div>
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
                    className="max-w-full rounded-full border border-warn/30 bg-surface px-3 py-1.5 text-left text-xs font-semibold text-warn hover:bg-warn-soft min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
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

          {/* Phones: supplier row above the items, like the iOS receiving screen. */}
          <div className="mb-ios-section rounded-[22px] bg-surface p-ios-inset lg:hidden">
            <span className="mb-1.5 block text-[15px] text-ios-label-secondary">{t("purchases.cols.supplier")} *</span>
            {supplierPicker}
            {supplierDebt}
          </div>

          <div className="flex-1 min-h-[280px] overflow-visible bg-surface border border-border rounded-card lg:overflow-auto max-lg:min-h-0 max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent">
            {lines.length === 0 ? (
              <>
                <Text as="div" variant="muted" className="h-full grid place-items-center max-lg:hidden" text={t("purchases.pickProduct")} />
                <div className="flex flex-col items-center px-8 pb-6 pt-14 text-center lg:hidden">
                  <span className="grid size-14 place-items-center rounded-full bg-surface text-ios-label-secondary"><Search className="size-6" aria-hidden="true" /></span>
                  <p className="mt-4 text-[17px] font-semibold">{t("purchases.mobileNoProducts")}</p>
                  <p className="mt-1 text-[15px] text-ios-label-secondary">{t("purchases.mobileAddProductsHint")}</p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2 p-3 lg:hidden max-lg:space-y-ios-section max-lg:p-0">
                  {lines.map((l) => (
                    <MobileFormLineCard
                      key={l.productId}
                      title={(
                        <Link
                          href={Routes.product(l.productId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 min-w-11 max-w-full items-center font-semibold text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:min-h-0 lg:min-w-0"
                        >
                          {l.name}
                        </Link>
                      )}
                      subtitle={l.sku}
                      amount={(
                        <MoneyInput
                          aria-label={t("orders.cols.lineTotal")}
                          value={purchaseLineTotal(l)}
                          onChange={(value) => patchLineTotal(l.productId, value ?? 0)}
                          className="h-9 w-36 rounded-md border border-border bg-surface px-2 text-right text-sm font-black tabular-nums max-lg:h-11 max-lg:w-32 max-lg:rounded-[12px] max-lg:text-[17px] max-lg:font-semibold"
                        />
                      )}
                      actions={(
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => { clearError(); setLines((current) => current.filter((item) => item.productId !== l.productId)); }}
                          className="min-h-11 text-er"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("common.delete")}
                        </Button>
                      )}
                    >
                      <div className="grid grid-cols-2 gap-3 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-1.5 [&>div]:space-y-0 [&>div]:text-[13px] [&>div]:font-normal [&>div]:text-ios-label-secondary">
                        <div className="space-y-1 text-xs font-semibold text-slate-500">
                          <span>{t("products.fields.baseUnit")}</span>
                          <Select
                            aria-label={t("products.fields.baseUnit")}
                            value={l.unitName}
                            onChange={(event) => changeUnit(l.productId, event.target.value)}
                            className="h-11"
                            rootClassName="w-full"
                            menuMinWidth={140}
                            options={[
                              { value: l.baseUnit, label: l.baseUnit },
                              ...l.units.map((unit) => ({ value: unit.unitName, label: `${unit.unitName} (×${unit.multiplier})` })),
                            ]}
                          />
                        </div>
                        <div className="order-3 col-span-2 space-y-1 text-xs font-semibold text-slate-500">
                          <span>{t("purchases.cols.qty")}</span>
                          <QuantityInput
                            min={0}
                            value={l.quantity}
                            onChange={(quantity) => patch(l.productId, { quantity })}
                            touchTargets
                            decrementLabel={t("common.decreaseProductQuantity", { product: l.name })}
                            inputLabel={t("common.productQuantity", { product: l.name })}
                            incrementLabel={t("common.increaseProductQuantity", { product: l.name })}
                            className="min-h-11"
                          />
                        </div>
                        <div className="space-y-1 text-xs font-semibold text-slate-500">
                          <span>{t("purchases.cols.unitCost")}</span>
                          <MoneyInput aria-label={t("purchases.cols.unitCost")} value={l.unitCost} onChange={(value) => patch(l.productId, { unitCost: value ?? 0 })} className={cn(numCls, "h-11")} />
                        </div>
                        <div className="order-4 col-span-2 space-y-1 text-xs font-semibold text-slate-500">
                          <span>{t("orders.cols.discount")}</span>
                          <div className="flex items-center gap-1">
                            {l.discMode === "vnd" ? <MoneyInput aria-label={t("orders.cols.discount")} min={0} value={l.discInput} placeholder="0" onChange={(discInput) => patch(l.productId, { discInput: discInput ?? 0 })} className={cn(numCls, "h-11 min-w-0")} /> : <NumberInput max={100} decimals={2} thousandSeparator={false} aria-label={t("orders.cols.discount")} min={0} value={l.discInput} placeholder="0" onChange={(discInput) => patch(l.productId, { discInput: discInput ?? 0 })} className={cn(numCls, "h-11 min-w-0")} />}
                            <div className="flex shrink-0 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                              {(["vnd", "pct"] as const).map((mode) => (
                                <Button
                                  key={mode}
                                  type="button"
                                  onClick={() => patch(l.productId, { discMode: mode })}
                                  variant={l.discMode === mode ? "default" : "ghost"}
                                  aria-pressed={l.discMode === mode}
                                  className="h-11 min-w-11 rounded-none px-2 text-[11px] font-semibold"
                                >
                                  {mode === "vnd" ? "đ" : "%"}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </MobileFormLineCard>
                  ))}
                </div>
                <div className="hidden lg:block">
                  <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80">
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
                      <td className="px-3 py-2">
                        <Link href={Routes.product(l.productId)} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-600 hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-xs text-slate-400">{l.sku}</div>
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          aria-label={`${t("products.fields.baseUnit")} · ${l.name}`}
                          size="sm"
                          value={l.unitName}
                          onChange={(e) => changeUnit(l.productId, e.target.value)}
                          menuMinWidth={140}
                          options={[
                            { value: l.baseUnit, label: l.baseUnit },
                            ...l.units.map((u) => ({ value: u.unitName, label: `${u.unitName} (×${u.multiplier})` })),
                          ]}
                        />
                      </td>
                      <td className="px-2 py-2"><QuantityInput min={0} value={l.quantity} onChange={(quantity) => patch(l.productId, { quantity })} size="sm" className="w-28" /></td>
                      <td className="px-2 py-2"><MoneyInput value={l.unitCost} onChange={(v) => patch(l.productId, { unitCost: v ?? 0 })} className={numCls} /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          {l.discMode === "vnd" ? <MoneyInput min={0} value={l.discInput} placeholder="0" onChange={(discInput) => patch(l.productId, { discInput: discInput ?? 0 })} className={numCls} /> : <NumberInput max={100} decimals={2} thousandSeparator={false} min={0} value={l.discInput} placeholder="0" onChange={(discInput) => patch(l.productId, { discInput: discInput ?? 0 })} className={numCls} />}
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
                      <td className="px-3 py-2">
                        <MoneyInput
                          aria-label={`${t("orders.cols.lineTotal")} · ${l.name}`}
                          value={purchaseLineTotal(l)}
                          onChange={(value) => patchLineTotal(l.productId, value ?? 0)}
                          className={numCls}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button type="button" variant="ghost" size="iconSm" onClick={() => { clearError(); setLines((ls) => ls.filter((x) => x.productId !== l.productId)); }} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* phải: NCC + tổng tiền */}
        <div className={cn(
          "w-full lg:w-[380px] min-h-0 shrink-0 bg-surface border-t lg:border-t-0 lg:border-l border-border flex flex-col pb-32 lg:pb-0 lg:overflow-hidden",
          "max-lg:border-0 max-lg:bg-transparent max-lg:pb-[calc(env(safe-area-inset-bottom)+9rem)]",
          mobileStep === "items" && "max-lg:hidden",
        )}>
          <div className="flex flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto [&>*]:shrink-0 max-lg:mx-ios-inset max-lg:mt-1 max-lg:rounded-[22px] max-lg:bg-surface max-lg:p-ios-inset">
          <div className="max-lg:hidden">
            <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={`${t("purchases.cols.supplier")} *`} />
            {supplierPicker}
            {supplierDebt}
          </div>
          {/* Phones: who the receipt is from, as the iOS payment step's context row. */}
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3 lg:hidden">
            <span className="min-w-0">
              <span className="block text-[13px] text-ios-label-secondary">{t("purchases.cols.supplier")}</span>
              <span className="block truncate text-[17px] font-semibold">{selectedSupplier?.name ?? "—"}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[13px] text-ios-label-secondary">{t("purchases.subtotal")} ({lines.length})</span>
              <span className="block text-[17px] font-semibold tabular-nums">{formatCurrency(subtotal)}</span>
            </span>
          </div>
          {/* Receiving warehouse is temporarily hidden; retain the saved/default ID. */}
          <div>
            <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={t("purchases.invoiceNumber")} />
            <Input value={invoiceNumber} onChange={(e) => { clearError(); setInvoiceNumber(e.target.value); }} placeholder={t("purchases.invoiceNumberPlaceholder")} />
          </div>
          <DocumentTimeField
            label={t("documentTime.purchase")}
            value={occurredAt}
            placeholder={initialValues?.occurredAtLabel}
            onChange={(value) => { clearError(); setOccurredAt(value); }}
          />

          <div className="mt-1 pt-3 border-t border-border space-y-2.5 text-sm">
            <div className="flex justify-between items-center"><span className="text-slate-500">{t("purchases.subtotal")} ({lines.length})</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between items-center gap-2"><span className="text-slate-500">{t("pos.discount")}</span><MoneyInput value={discount || ""} placeholder="0" onChange={(v) => { clearError(); setDiscount(v ?? 0); }} className={cn(numCls, "w-32")} /></div>
            <div className="flex justify-between items-center gap-2">
              <label htmlFor="purchase-vat-rate" className="text-slate-500">VAT %</label>
              <NumberInput id="purchase-vat-rate" min={0} max={100} value={vatRate} placeholder="0" suffix="%" thousandSeparator={false} onChange={(value) => { clearError(); setVatRate(value ?? 0); }} className={cn(numCls, "w-32")} />
            </div>
            <div className="text-right tabular-nums text-xs text-slate-500">{formatCurrency(tax)}</div>
            <div className="flex justify-between items-center gap-2">
              <label htmlFor="purchase-shipping-fee" className="text-slate-500">Phí vận chuyển</label>
              <MoneyInput id="purchase-shipping-fee" min={0} value={shippingFee || ""} placeholder="0" onChange={(value) => { clearError(); setShippingFee(value ?? 0); }} className={cn(numCls, "w-32")} />
            </div>
            <div className="flex justify-between items-center text-base font-semibold pt-1"><span>{t("purchases.needPay")}</span><span className="text-primary-600 tabular-nums">{formatCurrency(total)}</span></div>

            <label className="flex min-h-11 min-w-11 items-center gap-2 pt-1 text-sm max-lg:hidden lg:min-h-0 lg:min-w-0"><Checkbox checked={payFull} onChange={(e) => { clearError(); setPayFull(e.target.checked); }}  />{t("purchases.payFull")}</label>
            <div className="flex min-h-[52px] items-center justify-between gap-3 lg:hidden">
              <span className="text-[17px]">{t("purchases.payFull")}</span>
              <TouchTargetToggle checked={payFull} onChange={(checked) => { clearError(); setPayFull(checked); }} aria-label={t("purchases.payFull")} />
            </div>
            {!payFull && (
              <div className="flex justify-between items-center gap-2"><span className="text-slate-500">{t("purchases.amountPaid")}</span><MoneyInput value={amountPaid || ""} placeholder="0" onChange={(v) => { clearError(); setAmountPaid(v ?? 0); }} className={cn(numCls, "w-36")} /></div>
            )}
            <div className="flex justify-between items-center"><span className="text-slate-500">{t("purchases.cols.owed")}</span><span className={cn("tabular-nums font-semibold", owed > 0 ? "text-warn" : "text-slate-400")}>{formatCurrency(owed)}</span></div>
          </div>

          <Textarea value={note} onChange={(e) => { clearError(); setNote(e.target.value); }} placeholder={t("orders.detail.notePlaceholder")} rows={3} className="h-24 shrink-0 resize-none" />

          {error && (
            <div role="alert" className="flex items-start justify-between gap-2">
              <Text as="p" variant="destructive" text={error} />
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={clearError}
                className="min-h-11 min-w-11 shrink-0 text-sm font-medium text-red-600 underline-offset-2 hover:underline"
              >
                {t("common.close")}
              </button>
            </div>
          )}
          </div>

          <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 shrink-0 border-t border-border bg-surface p-3 sm:p-4 lg:static max-lg:bottom-0 max-lg:border-black/[0.08] dark:max-lg:border-white/10 max-lg:bg-surface/90 max-lg:px-ios-inset max-lg:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] max-lg:backdrop-blur-xl">
            {savedReceipt ? (
              <div role="status" className="rounded-card border border-primary-600/20 bg-primary-600/5 p-3">
                <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                  {t(savedReceipt.isDraft ? "purchases.draftSavedMessage" : "purchases.savedMessage", { code: savedReceipt.code })}
                </p>
                <a href={savedReceipt.href} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-card bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110">
                  {t("purchases.openSavedReceipt")}
                </a>
              </div>
            ) : (
              <>
                {canSaveDraft && <p className="mb-2 text-xs text-slate-500 max-lg:hidden">{t("purchases.draftHint")}</p>}
                <div className="flex gap-2">
                  {canSaveDraft && <Button type="button" onClick={() => void submit("draft")} disabled={!canSubmit || busy} loading={pendingAction === "draft"} variant="outline" className="h-12 shrink-0 rounded-card font-semibold">
                    {t("purchases.saveDraft")}
                  </Button>}
                  <Button type="button" onClick={() => void submit("receive")} disabled={!canSubmit || busy} loading={pendingAction === "receive"} className="h-12 min-w-0 flex-1 rounded-card font-semibold">
                    {mode === "edit" && purchaseStatus !== "draft" ? t("purchases.saveChanges") : t("purchases.complete")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Phones, step 1: amount due and Continue, like the iOS receiving action bar. */}
      {mobileStep === "items" && !savedReceipt && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-black/[0.08] bg-surface/90 dark:border-white/10 px-ios-inset pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl lg:hidden">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ios-label-secondary">{t("purchases.needPay")} · {lines.length}</p>
            <p className="truncate text-[17px] font-semibold tabular-nums">{formatCurrency(total)}</p>
          </div>
          <Button
            type="button"
            onClick={() => { clearError(); setMobileStep("payment"); window.scrollTo({ top: 0 }); }}
            disabled={lines.length === 0 || !supplierId}
            className="h-[50px] min-w-[9rem] shrink-0 !rounded-[14px] bg-ios-accent px-6 text-[17px] font-semibold"
          >
            {t("purchases.mobileContinue")}
          </Button>
        </div>
      )}

      <SupplierCreateDialog
        open={supplierCreateOpen}
        onOpenChange={setSupplierCreateOpen}
        onCreated={(supplier) => {
          setCreatedSuppliers((current) => current.some((existing) => existing.id === supplier.id)
            ? current
            : [...current, { id: supplier.id, name: supplier.name, currentDebt: "0" }]);
          setSupplierId(supplier.id);
          setSupplierCreateOpen(false);
        }}
      />

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
          allowUnresolvedApply
          hasExistingData={hasAiMergeRisk}
          existingDataLabel={t("aiQuick.purchase.existingData")}
          onClose={() => setAiQuickOpen(false)}
          onApply={applyAiPreview}
        />
      )}
    </div>
  );
}
