"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Ban,
  Barcode,
  Copy,
  ImageIcon,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Store,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { deleteProduct, setProductActive } from "@/lib/actions/products";
import { setCameraMaterial } from "@/lib/actions/products";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { ProductListResult } from "@/lib/data/products";
import {
  isProductStockManaged,
  productStockDisplay,
} from "./product-stock-display";

type ProductRow = ProductListResult["rows"][number];
type StockMovementRow = ProductRow["stockMovements"][number];
type ProductExpandTab =
  | "info"
  | "description"
  | "stockCard"
  | "stock"
  | "related";

const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";
const PRODUCT_EXPAND_TABS: ProductExpandTab[] = [
  "info",
  "description",
  "stockCard",
  "stock",
  "related",
];
const MOVEMENT_TYPE_KEYS: Record<string, string> = {
  purchase: "purchase",
  sale: "sale",
  return_in: "returnIn",
  return_out: "returnOut",
  transfer: "transfer",
  adjust: "adjust",
  init: "init",
  internal_use: "internalUse",
};

export function ProductsTable({
  rows,
  initialExpandedId,
  cameraMaterials = false,
}: {
  rows: ProductListResult["rows"];
  initialExpandedId?: string;
  cameraMaterials?: boolean;
}) {
  const t = useTranslations();
  const columns: DataTableColumn<ProductRow>[] = [
    {
      key: "product",
      label: t("products.list.colProduct"),
      required: true,
      width: "30%",
      render: (product) => (
        <div className="flex items-center gap-3">
          <ProductThumbnail product={product} />
          <div className="min-w-0">
            <div className="whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">{product.name}</div>
            <div className="truncate text-xs text-slate-400">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</div>
          </div>
        </div>
      ),
    },
    { key: "category", label: t("products.list.colCategory"), defaultVisible: true, render: (product) => <span className="text-slate-500">{product.categoryName ?? "—"}</span> },
    { key: "units", label: t("products.list.colUnits"), defaultVisible: true, render: (product) => <span className="text-slate-500">{product.baseUnit}{product.unitNames ? ` · ${product.unitNames}` : ""}</span> },
    { key: "cost", label: t("products.list.colCost"), defaultVisible: true, align: "right", render: (product) => priceRange(product.minCostPrice, product.maxCostPrice, product.costPrice) },
    { key: "salePrice", label: t("products.list.colSalePrice"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (product) => priceRange(product.minRetailPrice, product.maxRetailPrice, product.retailPrice) },
    {
      key: "stock",
      label: t("products.list.colStock"),
      defaultVisible: true,
      align: "right",
      cellClassName: (product) => {
        if (!isProductStockManaged(product.categoryName)) {
          return "font-medium text-slate-400";
        }
        const stock = Number(product.totalStock);
        const min = Number(product.minLevel);
        return min > 0 && stock <= min ? "font-semibold text-er" : "font-semibold text-slate-700 dark:text-slate-300";
      },
      render: (product) => productStockDisplay(product, t("products.stock.notTracked")),
    },
    { key: "status", label: t("products.list.colStatus"), defaultVisible: true, render: (product) => <StatusBadge product={product} /> },
  ];

  return (
    <DataTableShell
      tableId="inventory.products"
      rows={rows}
      columns={columns}
      getRowId={(product) => product.id}
      expandedParam="expanded"
      initialExpandedId={initialExpandedId}
      minWidth="1120px"
      renderExpanded={(product) => <ExpandedProduct product={product} cameraMaterials={cameraMaterials} />}
      renderMobileRow={({ row: product, toggle }) => (
        <button type="button" onClick={toggle} className="w-full p-3 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <ProductThumbnail product={product} />
              <div className="min-w-0">
                <div className="whitespace-normal break-words font-medium">{product.name}</div>
                <div className="truncate text-xs text-slate-400">{product.sku}{product.categoryName ? ` · ${product.categoryName}` : ""}</div>
              </div>
            </div>
            <StatusBadge product={product} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Metric label={t("products.list.colCost")} value={priceRange(product.minCostPrice, product.maxCostPrice, product.costPrice)} />
            <Metric label={t("products.list.colSalePrice")} value={priceRange(product.minRetailPrice, product.maxRetailPrice, product.retailPrice)} />
            <Metric label={t("products.list.colStock")} value={productStockDisplay(product, t("products.stock.notTracked"))} />
          </div>
        </button>
      )}
    />
  );
}

function ProductThumbnail({ product }: { product: ProductRow }) {
  const image = Array.isArray(product.imageUrls) && typeof product.imageUrls[0] === "string"
    ? product.imageUrls[0]
    : null;
  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border-soft bg-white dark:bg-slate-900">
      {image ? (
        <Image
          src={image}
          alt={product.name}
          fill
          sizes="44px"
          className="object-contain p-1"
          unoptimized
        />
      ) : (
        <div className="grid h-full place-items-center text-slate-300 dark:text-slate-600">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

function ExpandedProduct({ product, cameraMaterials = false }: { product: ProductRow; cameraMaterials?: boolean }) {
  const t = useTranslations();
  const [tab, setTab] = useState<ProductExpandTab>("info");
  const specs = specEntries(product.specs);
  const orderNote = orderNoteFromSpecs(product.specs);
  const image = Array.isArray(product.imageUrls)
    ? product.imageUrls[0]
    : undefined;
  const effectiveActive = product.isVariantParent
    ? product.children.some((child) => child.isActive)
    : product.isActive;

  if (cameraMaterials) {
    return (
      <div className="border-t border-border-soft bg-surface px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <InfoItem label={t("products.fields.sku")} value={product.sku} />
          <InfoItem label={t("products.pricing.retailPrice")} value={formatCurrency(Number(product.retailPrice))} />
          <InfoItem label={t("products.list.colUnits")} value={product.baseUnit} />
        </div>
        <ProductActionBar product={product} cameraMaterials />
      </div>
    );
  }

  return (
    <div className="border-t border-border-soft bg-surface px-4 py-4">
      <div className="flex items-center gap-6 overflow-x-auto border-b border-border-soft text-sm font-semibold text-slate-500">
        {PRODUCT_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "shrink-0 border-b-2 pb-2 transition-colors",
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`products.expand.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "info" && (
          <ProductInfoPanel
            product={product}
            image={image}
            specs={specs}
            effectiveActive={effectiveActive}
          />
        )}
        {tab === "description" && (
          <ProductDescriptionPanel product={product} orderNote={orderNote} />
        )}
        {tab === "stockCard" && <ProductStockCardPanel product={product} />}
        {tab === "stock" && (
          <ProductStockPanel
            product={product}
            effectiveActive={effectiveActive}
          />
        )}
        {tab === "related" && <RelatedProductsPanel product={product} />}
      </div>

      <ProductActionBar product={product} />
    </div>
  );
}

function ProductInfoPanel({
  product,
  image,
  specs,
  effectiveActive,
}: {
  product: ProductRow;
  image?: string;
  specs: Array<readonly [string, string]>;
  effectiveActive: boolean;
}) {
  const t = useTranslations();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[160px_1fr]">
      <div className="relative h-36 w-36 overflow-hidden rounded-card border border-border bg-primary-50/50">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="144px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="grid h-full place-items-center text-primary-300">
            <ImageIcon className="h-12 w-12" />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-bold text-slate-900 dark:text-slate-100">
              {product.name}
            </h3>
            <div className="mt-1 text-sm text-slate-500">
              {t("products.fields.category")}: {product.categoryName ?? "—"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge
                text={
                  product.isVariantParent
                    ? t("products.list.group")
                    : t("products.expand.normalProduct")
                }
              />
              <Badge
                text={
                  effectiveActive
                    ? t("products.directSale")
                    : t("products.list.inactive")
                }
                tone={effectiveActive ? "ok" : "muted"}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoItem label={t("products.fields.sku")} value={product.sku} />
          <InfoItem
            label={t("products.fields.barcode")}
            value={product.barcode}
          />
          <InfoItem
            label={t("products.pricing.costPrice")}
            value={formatCurrency(Number(product.costPrice))}
          />
          <InfoItem
            label={t("products.pricing.retailPrice")}
            value={formatCurrency(Number(product.retailPrice))}
          />
          <InfoItem
            label={t("products.stock.current")}
            value={productStockDisplay(product, t("products.stock.notTracked"))}
          />
          <InfoItem
            label={t("products.stock.min")}
            value={
              isProductStockManaged(product.categoryName) && Number(product.minLevel) > 0
                ? formatNumber(Number(product.minLevel))
                : undefined
            }
          />
          <InfoItem
            label={t("products.physical.location")}
            value={product.location}
          />
          <InfoItem
            label={t("products.fields.brand")}
            value={product.brandName}
          />
          <InfoItem
            label={t("products.physical.weight")}
            value={product.weight ? formatNumber(product.weight) : undefined}
          />
          <InfoItem
            label={t("products.physical.dimensions")}
            value={product.dimensions}
          />
        </div>

        {specs.length > 0 && (
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {specs.map(([key, value]) => (
              <InfoItem key={key} label={key} value={value} />
            ))}
          </div>
        )}

        {product.children.length > 0 && (
          <div className="rounded-card border border-border-soft">
            <div className="border-b border-border-soft px-3 py-2 text-sm font-semibold">
              {t("products.expand.childSkus")}
            </div>
            <div className="divide-y divide-border-soft">
              {product.children.map((child) => (
                <Link
                  key={child.id}
                  href={Routes.product(child.id)}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block break-words font-medium">
                      {child.variantName ?? child.name}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {child.sku}
                    </span>
                  </span>
                  <span className="tabular-nums font-semibold">
                    {formatCurrency(Number(child.retailPrice))}
                  </span>
                  <span className="tabular-nums text-slate-500">
                    {productStockDisplay(
                      { ...child, categoryName: product.categoryName },
                      t("products.stock.notTracked"),
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductDescriptionPanel({
  product,
  orderNote,
}: {
  product: ProductRow;
  orderNote: string;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-3">
      <TextPanel
        title={t("products.expand.descriptionTitle")}
        value={product.description || t("products.expand.emptyDescription")}
        muted={!product.description}
      />
      <TextPanel
        title={t("products.expand.orderNoteTitle")}
        value={orderNote || t("products.expand.emptyOrderNote")}
        muted={!orderNote}
      />
    </div>
  );
}

function TextPanel({
  title,
  value,
  muted = false,
}: {
  title: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <section className="rounded-card border border-border-soft px-4 py-3">
      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
        {title}
      </h4>
      <p
        className={cn(
          "mt-4 min-h-7 whitespace-pre-wrap text-sm",
          muted
            ? "text-center text-slate-400"
            : "text-slate-700 dark:text-slate-200",
        )}
      >
        {value}
      </p>
    </section>
  );
}

function ProductStockCardPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const movements = product.stockMovements;

  if (!isProductStockManaged(product.categoryName))
    return <EmptyPanel message={t("products.stock.notTracked")} />;

  if (movements.length === 0)
    return <EmptyPanel message={t("products.expand.stockCardEmpty")} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.document")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.time")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.transactionType")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.partner")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.transactionPrice")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.costPrice")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.quantity")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.stockAfter")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {movements.map((movement) => (
            <tr key={movement.id} className="align-top">
              <td className="px-3 py-3 font-semibold">
                <DocumentValue movement={movement} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-slate-700 dark:text-slate-200">
                {formatDate(movement.createdAt)}
              </td>
              <td className="px-3 py-3">
                {t(movementTypeKey(movement.type) as never)}
              </td>
              <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                {movement.partnerName || "—"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {moneyOrDash(movement.transactionPrice)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {moneyOrDash(movement.unitCost)}
              </td>
              <td
                className={cn(
                  "px-3 py-3 text-right tabular-nums font-semibold",
                  Number(movement.quantity) < 0 ? "text-er" : "text-ok",
                )}
              >
                {formatSignedNumber(movement.quantity)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatNumber(Number(movement.stockAfter))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductStockPanel({
  product,
  effectiveActive,
}: {
  product: ProductRow;
  effectiveActive: boolean;
}) {
  const t = useTranslations();

  if (!isProductStockManaged(product.categoryName))
    return <EmptyPanel message={t("products.stock.notTracked")} />;

  const rows =
    product.stockLocations.length > 0
      ? product.stockLocations
      : [
          {
            warehouseId: "summary",
            warehouseName:
              product.location || t("products.expand.defaultWarehouse"),
            quantity: Number(product.totalStock),
            reserved: Number(product.reservedStock ?? 0),
            minLevel: Number(product.minLevel),
          },
        ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.warehouse")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.stock")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.reserved")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.daysToOut")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.status")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {rows.map((row) => {
            const low = row.minLevel > 0 && row.quantity <= row.minLevel;
            return (
              <tr key={row.warehouseId}>
                <td className="px-3 py-3 font-medium">{row.warehouseName}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatNumber(row.quantity)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatNumber(row.reserved)}
                </td>
                <td
                  className={cn(
                    "px-3 py-3",
                    low ? "font-semibold text-warn" : "text-slate-500",
                  )}
                >
                  {low ? t("products.expand.lowStock") : "—"}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
                      effectiveActive
                        ? "bg-ok-soft text-ok"
                        : "bg-surface-2 text-slate-500",
                    )}
                  >
                    {effectiveActive
                      ? t("products.expand.selling")
                      : t("products.expand.stopped")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RelatedProductsPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const rows = product.relatedProducts;

  if (rows.length === 0)
    return <EmptyPanel message={t("products.expand.relatedEmpty")} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.sku")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.name")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.salePrice")}
            </th>
            <th className="px-3 py-3 font-semibold">
              {t("products.expand.cols.vat")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.costPrice")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.stock")}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t("products.expand.cols.reserved")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {rows.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="px-3 py-3">
                <Link
                  href={Routes.product(item.id)}
                  className="font-semibold text-primary-600 hover:underline"
                >
                  {item.sku}
                </Link>
              </td>
              <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">
                {item.name}
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-semibold">
                {formatCurrency(Number(item.retailPrice))}
              </td>
              <td className="px-3 py-3 text-slate-500">
                {t("products.expand.notTaxed")}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatCurrency(Number(item.costPrice))}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {productStockDisplay(
                  { ...item, categoryName: product.categoryName },
                  t("products.stock.notTracked"),
                )}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {isProductStockManaged(product.categoryName)
                  ? formatNumber(Number(item.reservedStock))
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-border-soft px-4 py-10 text-center text-sm font-medium text-slate-400">
      {message}
    </div>
  );
}

function DocumentValue({ movement }: { movement: StockMovementRow }) {
  const label =
    movement.documentCode || movement.note || movement.refType || "—";
  if (movement.refType === "order" && movement.refId) {
    return (
      <Link
        href={`${Routes.Sales}?tab=orders&orderId=${encodeURIComponent(movement.refId)}&expandedOrder=${encodeURIComponent(movement.refId)}`}
        className="text-primary-600 hover:underline"
      >
        {label}
      </Link>
    );
  }
  return <span className="text-primary-600">{label}</span>;
}

function ProductActionBar({ product, cameraMaterials = false }: { product: ProductRow; cameraMaterials?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const dialog = useConfirmDialog();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const effectiveActive = product.isVariantParent
    ? product.children.some((child) => child.isActive)
    : product.isActive;
  const nextActive = !effectiveActive;
  const sameTypeSourceId = product.parentProductId ?? product.id;

  function toggleCameraMaterial() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      const res = await setCameraMaterial({ productId: product.id, enabled: !cameraMaterials });
      if (res.ok) clearExpandedAndRefresh();
      else setError(t(res.error as never));
    });
  }

  function clearExpandedAndRefresh() {
    const sp = new URLSearchParams(params.toString());
    sp.delete("expanded");
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    router.refresh();
  }

  async function removeProduct() {
    if (pending) return;
    const ok = await dialog.confirm({
      description: t("products.confirm.delete"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setError("");
    startTransition(async () => {
      const res = await deleteProduct(product.id);
      if (res.ok) clearExpandedAndRefresh();
      else setError(t(res.error as never));
    });
  }

  async function toggleActive() {
    const confirmKey = nextActive
      ? "products.confirm.resumeSelling"
      : "products.confirm.stopSelling";
    if (pending) return;
    const ok = await dialog.confirm({
      description: t(confirmKey as never),
      confirmLabel: t(
        (nextActive
          ? "products.actions.resumeSelling"
          : "products.actions.stopSelling") as never,
      ),
      variant: "warning",
    });
    if (!ok) return;
    setError("");
    startTransition(async () => {
      const res = await setProductActive({
        productId: product.id,
        isActive: nextActive,
      });
      if (res.ok) router.refresh();
      else setError(t(res.error as never));
    });
  }

  function productModalHref(patch: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", "products");
    sp.delete("productModal");
    sp.delete("productId");
    sp.delete("copyFrom");
    sp.delete("sameTypeAs");
    sp.delete("onlineProductId");
    sp.delete("shopeeProductId");
    for (const [key, value] of Object.entries(patch)) sp.set(key, value);
    return `${pathname}?${sp.toString()}`;
  }

  return (
    <div className="border-t border-border-soft pt-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={cameraMaterials ? Trash2 : PackagePlus}
            label={cameraMaterials
              ? (locale === "vi" ? "Xóa khỏi vật tư lắp camera" : "Remove from camera materials")
              : (locale === "vi" ? "Thêm vào vật tư lắp camera" : "Add to camera materials")}
            onClick={toggleCameraMaterial}
            disabled={pending}
            tone={cameraMaterials ? "danger" : "neutral"}
          />
          {!cameraMaterials && <>
            <ActionButton
              icon={Trash2}
              label={t("products.actions.delete")}
              onClick={removeProduct}
              disabled={pending}
              tone="danger"
            />
            <ActionLink
              icon={Copy}
              label={t("products.actions.copy")}
              href={productModalHref({
                productModal: "copy",
                copyFrom: product.id,
              })}
            />
          </>}
        </div>
        {!cameraMaterials && <div className="flex flex-wrap gap-2 xl:justify-end">
          <ActionLink
            icon={Pencil}
            label={t("products.actions.edit")}
            href={productModalHref({
              productModal: "edit",
              productId: product.id,
            })}
            tone="primary"
          />
          <div
            className="relative"
            onMouseEnter={() => setMoreOpen(true)}
            onMouseLeave={() => setMoreOpen(false)}
          >
            <button
              type="button"
              aria-label={locale === "vi" ? "Thao tác khác" : "More actions"}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              onFocus={() => setMoreOpen(true)}
              className={cn(actionClassName, "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-11 z-30 min-w-52 rounded-lg border border-border bg-surface p-1 shadow-xl">
                <MenuActionLink
                  icon={Store}
                  label={locale === "vi" ? "Đăng sàn" : "List online"}
                  href={productModalHref({ onlineProductId: product.id })}
                />
                <MenuActionLink icon={Barcode} label={t("products.actions.printLabels")} href={Routes.productLabels(product.id)} />
                <MenuActionLink
                  icon={Plus}
                  label={t("products.actions.addSameType")}
                  href={productModalHref({ productModal: "sameType", sameTypeAs: sameTypeSourceId })}
                />
              </div>
            )}
          </div>
          <ActionLink
            icon={PackagePlus}
            label={t("products.actions.purchase")}
            href={Routes.purchaseNewForProduct(product.id)}
          />
          <ActionButton
            icon={Ban}
            label={t(
              (nextActive
                ? "products.actions.resumeSelling"
                : "products.actions.stopSelling") as never,
            )}
            onClick={toggleActive}
            disabled={pending}
          />
        </div>}
      </div>
      {error && <p className="mt-2 text-sm font-medium text-er">{error}</p>}
    </div>
  );
}

function ActionLink({
  href,
  icon: Icon,
  label,
  tone = "neutral",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone?: "neutral" | "primary";
}) {
  return (
    <Link
      href={href}
      className={cn(
        actionClassName,
        tone === "primary"
          ? "border-primary-600 bg-primary-600 text-white hover:border-primary-700 hover:bg-primary-700"
          : "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function MenuActionLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface-2 dark:text-slate-200">
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        actionClassName,
        tone === "danger"
          ? "border-transparent bg-transparent text-slate-600 hover:bg-red-50 hover:text-er dark:text-slate-300 dark:hover:bg-red-950/30"
          : "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

const actionClassName =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

function StatusBadge({ product }: { product: ProductRow }) {
  const t = useTranslations();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        product.isVariantParent
          ? "bg-primary-50 text-primary-700"
          : product.isActive
            ? "bg-ok-soft text-ok"
            : "bg-surface-2 text-slate-500",
      )}
    >
      {product.isVariantParent
        ? t("products.list.group")
        : product.isActive
          ? t("products.list.active")
          : t("products.list.inactive")}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="block text-slate-400">{label}</span>
      <span className="mt-0.5 block truncate font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </span>
  );
}

function InfoItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 min-h-5 text-sm font-medium text-slate-800 dark:text-slate-100">
        {value || "—"}
      </div>
    </div>
  );
}

function Badge({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "ok";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
        tone === "ok"
          ? "bg-ok-soft text-ok"
          : "bg-surface-2 text-slate-700 dark:text-slate-200",
      )}
    >
      {text}
    </span>
  );
}

function priceRange(
  minValue: string | number | null | undefined,
  maxValue: string | number | null | undefined,
  fallback: string | number,
) {
  const min = Number(minValue ?? fallback);
  const max = Number(maxValue ?? fallback);
  return min !== max
    ? `${formatCurrency(min)} - ${formatCurrency(max)}`
    : formatCurrency(max);
}

function moneyOrDash(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? formatCurrency(n) : "—";
}

function formatSignedNumber(value: string | number) {
  const n = Number(value);
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatNumber(n)}`;
}

function movementTypeKey(type: string) {
  return `products.expand.movementTypes.${MOVEMENT_TYPE_KEYS[type] ?? "adjust"}`;
}

function orderNoteFromSpecs(specs: unknown) {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return "";
  const value = (specs as Record<string, unknown>)[PRODUCT_ORDER_NOTE_SPEC_KEY];
  if (!value) return "";
  return Array.isArray(value) ? value.map(String).join(", ") : String(value);
}

function specEntries(specs: unknown) {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return [];
  return Object.entries(specs as Record<string, unknown>)
    .filter(([key]) => key !== PRODUCT_ORDER_NOTE_SPEC_KEY)
    .map(
      ([key, value]) =>
        [key, Array.isArray(value) ? value.join(", ") : String(value)] as const,
    );
}
