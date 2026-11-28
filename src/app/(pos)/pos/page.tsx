import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";
import { getPosData } from "@/lib/data/pos";
import { CAMERA_QUOTE_UTILITY_SKUS } from "@/lib/data/camera-quote-constants";
import { getStoreSettings } from "@/lib/data/settings";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { sourceInvoicePriceBookId } from "@/lib/pos/source-invoice-price-book";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { Routes } from "@/lib/routes";
import { formatDate } from "@/lib/utils";
import { requireStoreContext } from "@/lib/auth/store-context";
import { productCatalogScopeId } from "@/lib/product-catalog";
import { getProductSortPreference } from "@/lib/product-sort-preference-server";
import { getSyncRelayConfig } from "@/lib/sync/config";
import { PosClient, type PosSourceInvoice } from "./pos-client";
import type { PosInitialContext } from "./pos-client";
import { ProductEditorModal } from "@/app/(app)/inventory/tabs/products";
import { EditBlockedNotice } from "@/components/edit-blocked-notice";

export const dynamic = "force-dynamic";

type PosSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function csvUuids(value: string | string[] | undefined) {
  const raw = one(value);
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter((item) => UUID_RE.test(item));
}

type BlockedSourceEdit = { id: string; code: string; replacementId: string | null };

/**
 * Mirrors the save-time guard in createOrderForUser: an edit opened from a
 * stale page (the invoice was already edited, i.e. cancelled and replaced,
 * merged or returned meanwhile) must stop here, not after the user re-enters
 * every line and only then hits "notEditable" on save.
 */
function sourceEditable(mode: "edit" | "draft_edit", order: { status: string; documentType: string; replacedByOrderId: string | null }) {
  if (order.replacedByOrderId) return false;
  if (mode === "draft_edit") return order.status === "draft" && order.documentType === "sale";
  return order.status === "completed" || order.status === "quote" || order.status === "confirmed" || order.status === "draft";
}

async function sourceInvoiceFromParams(
  storeId: string,
  params: PosSearchParams,
): Promise<{ source: PosSourceInvoice | null; blocked: BlockedSourceEdit | null }> {
  const none = { source: null, blocked: null };
  const mode = one(params.sourceMode);
  const kind = one(params.sourceKind);
  const orderId = one(params.sourceOrderId);
  if ((mode !== "edit" && mode !== "draft_edit" && mode !== "copy" && mode !== "return") || !orderId || !UUID_RE.test(orderId)) return none;
  const order = await getOrder(storeId, orderId);
  if (!order) return none;
  if ((mode === "edit" || mode === "draft_edit") && !sourceEditable(mode, order)) {
    return { source: null, blocked: { id: order.id, code: order.code, replacementId: order.replacedByOrderId } };
  }
  const sourceKind = mode === "return"
    ? "return_invoice"
      : kind === "quote" || kind === "booking" || kind === "invoice"
        ? kind
      : order.status === "quote"
        ? "quote"
        : order.status === "confirmed"
          ? "booking"
          : "invoice";
  return { source: {
    mode,
    kind: sourceKind,
    id: order.id,
    code: order.code,
    saleTime: formatDate(order.createdAt),
    customerId: order.customerId ?? "",
    projectId: order.projectId ?? "",
    projectName: order.projectName ?? "",
    note: order.note ?? "",
    discount: Number(order.discount),
    shippingFee: Number(order.shippingFee),
    tax: Number(order.tax ?? 0),
    subtotal: Number(order.subtotal),
    amountPaid: Number(order.amountPaid),
    priceBookId: sourceInvoicePriceBookId(order.items),
    items: order.items.map((item) => {
      const pricing = readOrderLinePricing(item);
      return {
        productId: item.productId,
        unitName: item.unitName,
        quantity: Number(item.quantity),
        unitPrice: mode === "return" ? pricing.netUnitPrice : pricing.unitPrice,
        lineDiscount: mode === "return" ? 0 : pricing.lineDiscount,
        lineDiscountMode: mode === "return" ? "vnd" : pricing.lineDiscountMode,
        lineDiscountValue: mode === "return" ? 0 : pricing.lineDiscountValue,
        priceBookId: item.priceBookId,
        note: item.note ?? "",
      };
    }),
  }, blocked: null };
}

function initialContextFromParams(params: PosSearchParams): PosInitialContext | null {
  const kind = one(params.draft);
  if (kind !== "quote" && kind !== "invoice" && kind !== "booking" && kind !== "return_quick") return null;
  const projectId = one(params.projectId);
  const customerId = one(params.customerId);
  const projectName = one(params.projectName)?.trim() || (kind === "quote" ? "Báo giá" : "Hóa đơn");
  const rawItems = Array.isArray(params.item) ? params.item : params.item ? [params.item] : [];
  const items = rawItems.slice(0, 50).flatMap((raw) => {
    try {
      const item = JSON.parse(raw) as Record<string, unknown>;
      const itemProductId = typeof item.productId === "string" ? item.productId : "";
      const unitName = typeof item.unitName === "string" ? item.unitName.trim() : "";
      const quantity = Number(item.quantity);
      if (!UUID_RE.test(itemProductId) || !unitName || !Number.isFinite(quantity) || quantity <= 0) return [];
      return [{ productId: itemProductId, unitName, quantity }];
    } catch {
      return [];
    }
  });
  return {
    kind,
    projectId: projectId && UUID_RE.test(projectId) ? projectId : "",
    projectName,
    customerId: customerId && UUID_RE.test(customerId) ? customerId : "",
    items,
  };
}

export default async function POSPage({ searchParams }: { searchParams: Promise<PosSearchParams> }) {
  const params = await searchParams;
  const context = await requireStoreContext();
  const { source: sourceInvoice, blocked: blockedEdit } = await sourceInvoiceFromParams(context.storeId, params);
  if (blockedEdit) {
    return (
      <EditBlockedNotice
        code={blockedEdit.code}
        documentHref={Routes.order(blockedEdit.id)}
        replacementHref={blockedEdit.replacementId ? Routes.order(blockedEdit.replacementId) : null}
      />
    );
  }
  const baseInitialContext = initialContextFromParams(params);
  const bulkProductIds = csvUuids(params.productIds);
  const aiProductIds = csvUuids(params.aiProducts);
  const createdProductId = one(params.createdProductId);
  const validCreatedProductId = createdProductId && UUID_RE.test(createdProductId) ? createdProductId : null;
  const productModalParams = {
    productModal: one(params.productModal),
    productKind: one(params.productKind),
    returnTo: one(params.returnTo),
  };
  const includeProductIds = [
    ...(sourceInvoice?.items?.map((item) => item.productId) ?? []),
    ...(baseInitialContext?.items?.map((item) => item.productId) ?? []),
    ...bulkProductIds,
    ...aiProductIds,
    ...(validCreatedProductId ? [validCreatedProductId] : []),
  ];
  const defaultSort = await getProductSortPreference(context.storeId, context.role);
  const syncRelayEnabled = getSyncRelayConfig().enabled;
  const [data, settings, t, orderPrintTemplates, quotePrintTemplates, bookingPrintTemplates, returnPrintTemplates] = await Promise.all([
    getPosData(context.storeId, {
      includeProductIds,
      includeProductSkus: CAMERA_QUOTE_UTILITY_SKUS,
      includeProductCategories: ["Camera giám sát"],
      role: context.role,
      sort: defaultSort,
    }),
    getStoreSettings(context.storeId),
    getTranslations(),
    getPrintTemplatesForDoc(context.storeId, "order"),
    getPrintTemplatesForDoc(context.storeId, "quote"),
    getPrintTemplatesForDoc(context.storeId, "booking"),
    getPrintTemplatesForDoc(context.storeId, "return"),
  ]);
  const bulkItems = bulkProductIds.flatMap((productId) => {
    const product = data.products.find((candidate) => candidate.id === productId);
    return product?.baseUnit
      ? [{ productId, unitName: product.baseUnit, quantity: 1 }]
      : [];
  });
  const initialContext = baseInitialContext && bulkItems.length > 0
    ? {
        ...baseInitialContext,
        items: [
          ...(baseInitialContext.items ?? []),
          ...bulkItems.filter((item) => !(baseInitialContext.items ?? []).some((existing) => existing.productId === item.productId)),
        ],
      }
    : baseInitialContext;
  return (
    <>
    {/* Phones: no title bar, like the native Sales tab; content starts below the status bar. */}
    <div className="h-full flex flex-col max-lg:pt-[env(safe-area-inset-top)]">
      {/* top bar gọn — thay cho sidebar admin (giống KiotViet) */}
      <header className="hidden shrink-0 h-[58px] px-4 sm:px-6 lg:flex items-center justify-between bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <Link
          href={Routes.Home}
          className="flex items-center gap-2.5 min-w-0 rounded-lg pr-2 transition hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t("common.appName")}
        >
          <div className="w-7 h-7 rounded-lg grid place-items-center text-white font-extrabold text-sm bg-gradient-to-br from-primary-600 to-primary-400">H</div>
          <span className="font-bold text-sm truncate">{t("common.appName")}</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {t("nav.pos")}</span>
        </Link>
        <Link
          href={Routes.Dashboard}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span className="hidden sm:inline">{t("nav.dashboard")}</span>
        </Link>
      </header>
      <div className="flex-1 min-h-0">
        <PosClient
          storageScope={productCatalogScopeId(context.storeId, context.userId, context.role)}
          storeId={context.storeId}
          syncRelayEnabled={syncRelayEnabled}
          canRecoverLegacyOutbox={context.role === "owner" || context.role === "manager"}
          data={data}
          orderPrintTemplates={orderPrintTemplates}
          quotePrintTemplates={quotePrintTemplates}
          bookingPrintTemplates={bookingPrintTemplates}
          returnPrintTemplates={returnPrintTemplates}
          initialSourceInvoice={sourceInvoice}
          initialContext={initialContext}
          createdProductId={validCreatedProductId}
          posPrefs={settings.prefs.pos}
          taxPrefs={settings.prefs.tax}
          cameraQuoteSettings={settings.prefs.cameraQuote}
        />
      </div>
    </div>
    {productModalParams.productModal === "create" && (
      <ProductEditorModal
        searchParams={productModalParams}
        closeNavigation="replace"
        cancelNavigation="replace"
      />
    )}
    </>
  );
}
