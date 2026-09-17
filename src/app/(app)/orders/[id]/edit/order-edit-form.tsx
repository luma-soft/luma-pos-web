"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { cn, formatCurrency } from "@/lib/utils";
import { MoneyInput } from "@/components/ui/money-input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { OrderEditMobileLine } from "@/components/order-edit-mobile-line";
import { updateOrder } from "@/lib/actions/order-edit";
import { useProductCatalog } from "@/components/product-catalog-provider";
import type { ProductCatalogItem } from "@/lib/product-catalog";
import { ProductSearchPicker } from "@/components/product-search/product-search-picker";
import { ProductSearchResultLayout } from "@/components/product-search/product-search-layout";
import { ProductSearchThumbnail } from "@/components/product-search/product-search-thumbnail";

interface Line {
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
  preDiscountUnitPrice?: number;
  lineDiscount?: number;
  lineDiscountMode?: "pct" | "vnd";
  lineDiscountValue?: number;
  priceBookId?: string | null;
}

interface Props {
  orderId: string;
  orderCode: string;
  initial: {
    projectName: string; note: string; discount: number; shippingFee: number; amountPaid: number;
    items: Line[];
  };
}

export function OrderEditForm({ orderId, orderCode, initial }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const catalog = useProductCatalog();

  const [items, setItems] = useState<Line[]>(initial.items);
  const [discount, setDiscount] = useState(initial.discount);
  const [shippingFee, setShippingFee] = useState(initial.shippingFee);
  const [projectName, setProjectName] = useState(initial.projectName);
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const searchProducts = useCallback(
    (query: string) => catalog.search(query, { limit: catalog.products.length }),
    [catalog],
  );

  const subtotal = items.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount + shippingFee);
  const oldTotal = Math.max(0, initial.items.reduce((s, l) => s + l.quantity * l.unitPrice, 0) - initial.discount + initial.shippingFee);
  const delta = total - oldTotal;
  const newRemaining = Math.max(0, total - initial.amountPaid);

  function patch(idx: number, p: Partial<Line>) {
    setItems((ls) => ls.map((l, i) => (i === idx ? {
      ...l,
      ...p,
      ...(p.unitPrice == null ? {} : { preDiscountUnitPrice: p.unitPrice, lineDiscount: 0, lineDiscountMode: "vnd" as const, lineDiscountValue: 0 }),
    } : l)));
  }

  function addProduct(p: ProductCatalogItem) {
    setItems((ls) => [{
      productId: p.id, productName: p.name,
      unitName: p.baseUnit, unitMultiplier: 1,
      quantity: 1, unitPrice: Number(p.retailPrice),
    }, ...ls]);
  }

  async function save() {
    if (items.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await updateOrder({
      orderId,
      projectName: projectName || undefined,
      note: note || undefined,
      discount,
      shippingFee,
      items: items.filter((l) => l.quantity > 0).map((line) => ({ ...line, manualUnitPrice: line.preDiscountUnitPrice ?? line.unitPrice })),
    });
    setBusy(false);
    if (res.ok) router.push(Routes.salesOrder(orderId, "completed"));
    else setError(t(res.error as never));
  }

  const inputCls = "min-h-11 px-2 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums lg:min-h-0";

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <MobileDetailHeader
        backHref={Routes.salesOrder(orderId, "completed")}
        backLabel={t("common.back")}
        title={t("orderEdit.title", { code: orderCode })}
      />

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-card p-3 mb-4 text-sm text-amber-800 dark:text-amber-300">
        {t("orderEdit.warning")}
      </div>

      <div className="bg-surface border border-border rounded-card overflow-hidden mb-4">
        <div
          data-testid="order-edit-mobile-lines"
          className="space-y-3 p-3 lg:hidden"
        >
          {items.map((l, idx) => (
            <OrderEditMobileLine
              key={`${l.productId}-${idx}`}
              line={l}
              labels={{
                unit: t("orders.cols.unit"),
                quantity: t("orders.cols.qty"),
                unitPrice: t("orders.cols.unitPrice"),
                lineTotal: t("orders.cols.lineTotal"),
                delete: t("common.delete"),
              }}
              inputClassName={inputCls}
              onQuantityChange={(quantity) => patch(idx, { quantity })}
              onUnitPriceChange={(unitPrice) => patch(idx, { unitPrice })}
              onDelete={() => setItems((ls) => ls.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table data-testid="order-edit-desktop-table" className="w-full min-w-[840px] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-20" />
              <col className="w-36" />
              <col className="w-40" />
              <col className="w-44" />
              <col className="w-12" />
            </colgroup>
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("orders.cols.product")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.unit")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.qty")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.unitPrice")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
            {items.map((l, idx) => (
              <tr key={`${l.productId}-${idx}`}>
                <td className="px-4 py-2.5 font-medium [overflow-wrap:anywhere]">{l.productName}</td>
                <td className="px-4 py-2.5 text-slate-500 [overflow-wrap:anywhere]">{l.unitName}</td>
                <td className="px-4 py-2.5 text-right">
                  <QuantityInput
                    min={0}
                    value={l.quantity}
                    onChange={(quantity) => patch(idx, { quantity })}
                    size="sm"
                    className="ml-auto w-[132px] lg:w-28"
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <MoneyInput value={l.unitPrice}
                    onChange={(v) => patch(idx, { unitPrice: v ?? 0 })}
                    className={cn(inputCls, "w-full text-right")} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium [overflow-wrap:anywhere]">{formatCurrency(l.quantity * l.unitPrice)}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => setItems((ls) => ls.filter((_, i) => i !== idx))} className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-red-500 lg:min-h-0 lg:min-w-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border">
          <ProductSearchPicker
            query={productQuery}
            onQueryChange={setProductQuery}
            browseItems={catalog.products}
            loadItems={searchProducts}
            itemKey={(product) => product.id}
            onSelect={addProduct}
            isItemSelected={(product) => items.some((line) => line.productId === product.id)}
            placeholder={`＋ ${t("purchases.addProduct")}`}
            emptyMessage={t("pos.noSearchResults")}
            loadingMessage={t("common.loading")}
            unavailableMessage={t("common.error")}
            closeLabel={t("common.close")}
            loadMoreLabel={t("common.loadMore")}
            catalogStatus={catalog.status === "loading" ? "loading" : catalog.status === "unavailable" ? "unavailable" : "ready"}
            inputClassName="border-dashed bg-transparent"
            renderItem={(product, { selected }) => {
              const lineIndex = items.findIndex((line) => line.productId === product.id);
              const line = lineIndex >= 0 ? items[lineIndex] : null;
              return (
                <ProductSearchResultLayout
                  selected={selected}
                  leading={<ProductSearchThumbnail product={product} />}
                  summary={<><div className="text-sm font-semibold">{product.name}</div><div className="font-mono text-xs text-slate-400">{product.sku} · {product.baseUnit}</div></>}
                  controls={selected && line ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <QuantityInput size="sm" min={0} value={line.quantity} onChange={(quantity) => patch(lineIndex, { quantity })} inputLabel={t("common.productQuantity", { product: product.name })} />
                    </div>
                  ) : <span className="text-sm font-semibold text-primary-600 tabular-nums">{formatCurrency(Number(product.retailPrice))}</span>}
                />
              );
            }}
          />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-card p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("pos.discount")}</label>
            <MoneyInput value={discount} onChange={(v) => setDiscount(v ?? 0)} className={cn(inputCls, "w-full text-right")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("pos.shipping")}</label>
            <MoneyInput value={shippingFee} onChange={(v) => setShippingFee(v ?? 0)} className={cn(inputCls, "w-full text-right")} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("orders.cols.project")}</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className={cn(inputCls, "w-full")} />
          </div>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("orders.detail.notePlaceholder")} className={cn(inputCls, "w-full")} />

        <div className="flex items-end justify-between flex-wrap gap-4 pt-2 border-t border-border">
          <div className="text-sm space-y-1">
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.oldTotal")}</span><span className="tabular-nums line-through text-slate-400">{formatCurrency(oldTotal)}</span></div>
            <div className="flex gap-6 justify-between"><b>{t("orderEdit.newTotal")}</b><b className="tabular-nums text-primary-600">{formatCurrency(total)}</b></div>
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.delta")}</span>
              <span className={cn("tabular-nums font-semibold", delta > 0 ? "text-warn" : delta < 0 ? "text-ok" : "text-slate-400")}>
                {delta >= 0 ? "+" : ""}{formatCurrency(delta)}
              </span>
            </div>
            <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orderEdit.newRemaining")}</span><span className="tabular-nums font-semibold text-er">{formatCurrency(newRemaining)}</span></div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {error && <p className="text-sm text-er">{error}</p>}
            <button onClick={save} disabled={busy || items.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("orderEdit.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
