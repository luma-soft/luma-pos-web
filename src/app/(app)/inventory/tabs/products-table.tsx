"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Ban,
  Barcode,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageIcon,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Store,
  Trash2,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import {
  DataTableShell,
  stopRowToggle,
  type DataTableColumn,
} from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { OrderDetailLink } from "@/components/order-detail-link";
import { deleteProduct, setProductActive } from "@/lib/actions/products";
import { setCameraMaterial } from "@/lib/actions/products";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { positionFloatingMenu } from "@/lib/floating-menu-position";
import type { ProductListResult } from "@/lib/data/products";
import {
  isProductStockManaged,
  productStockDisplay,
} from "@/lib/product-stock";
import { useProductSelection } from "./product-selection";

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
  selectionEnabled = true,
}: {
  rows: ProductListResult["rows"];
  selectionEnabled?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { selectedIds, selectedVisibleIds, allSelected, toggle, toggleAll } =
    useProductSelection();

  function openProduct(product: ProductRow) {
    router.push(Routes.productDetail(product.id), { scroll: false });
  }

  const columns: DataTableColumn<ProductRow>[] = [
    ...(selectionEnabled ? [{
      key: "select",
      label: (
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={
            selectedVisibleIds.length > 0 && !allSelected
          }
          onChange={toggleAll}
          label={t("products.bulk.selectAll")}
        />
      ),
      required: true,
      width: "44px",
      align: "center",
      render: (product) => (
        <SelectionCheckbox
          checked={selectedIds.has(product.id)}
          onChange={() => toggle(product.id)}
          label={t("products.bulk.selectProduct", {
            name: product.name,
          })}
        />
      ),
    } satisfies DataTableColumn<ProductRow>] : []),
    {
      key: "product",
      label: t("products.list.colProduct"),
      required: true,
      width: "30%",
      render: (product) => (
        <div className="flex items-center gap-3">
          <ProductThumbnail product={product} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="whitespace-normal break-words font-medium text-slate-900 dark:text-slate-100">{product.name}</div>
              <ProductKindBadge kind={product.productKind} />
            </div>
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
        if (!isProductStockManaged(product.categoryName, product.productKind)) {
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
    <>
      {selectionEnabled && (
        <ProductMobileSelectionToolbar
          checked={allSelected}
          indeterminate={selectedVisibleIds.length > 0 && !allSelected}
          selectedCount={selectedVisibleIds.length}
          selectAllLabel={t("products.bulk.selectAll")}
          selectedLabel={t("products.bulk.selected", {
            count: selectedVisibleIds.length,
          })}
          onToggleAll={toggleAll}
        />
      )}
      <DataTableShell
        tableId="inventory.products"
        rows={rows}
        columns={columns}
        getRowId={(product) => product.id}
        minWidth="1120px"
        maxHeight="calc(100dvh - 250px)"
        fillHeight
        mobileListClassName="!space-y-0 overflow-hidden rounded-xl border border-border-soft bg-surface"
        mobileRowClassName="!rounded-none !border-x-0 !border-t-0 last:!border-b-0"
        onRowClick={openProduct}
        rowClassName={(product) =>
          selectedIds.has(product.id)
            ? "bg-primary-50/50 dark:bg-primary-950/20"
            : undefined
        }
        renderMobileRow={({ row: product }) => (
          <ProductMobileRow
            product={product}
            selectionEnabled={selectionEnabled}
            selected={selectedIds.has(product.id)}
            selectLabel={t("products.bulk.selectProduct", {
              name: product.name,
            })}
            stockNotTrackedLabel={t("products.stock.notTracked")}
            onToggle={() => toggle(product.id)}
            onOpen={() => openProduct(product)}
          />
        )}
      />
    </>
  );
}

export function ProductMobileSelectionToolbar({
  checked,
  indeterminate,
  selectedCount,
  selectAllLabel,
  selectedLabel,
  onToggleAll,
}: {
  checked: boolean;
  indeterminate: boolean;
  selectedCount: number;
  selectAllLabel: string;
  selectedLabel: string;
  onToggleAll: () => void;
}) {
  return (
    <div className="mb-2 flex w-full items-center gap-2 lg:hidden">
      <SelectionCheckbox
        checked={checked}
        indeterminate={indeterminate}
        onChange={onToggleAll}
        label={selectAllLabel}
      />
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300" aria-live="polite">
        {selectedLabel}
      </span>
      {selectedCount > 0 && (
        <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-700">
          {selectedCount}
        </span>
      )}
    </div>
  );
}

export function ProductMobileRow({
  product,
  selectionEnabled,
  selected,
  selectLabel,
  stockNotTrackedLabel,
  onToggle,
  onOpen,
}: {
  product: ProductRow;
  selectionEnabled: boolean;
  selected: boolean;
  selectLabel: string;
  stockNotTrackedLabel: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={cn("flex min-w-0 items-stretch", selected && "bg-primary-50/50 dark:bg-primary-950/20")}>
      {selectionEnabled && (
        <div className="shrink-0 p-3 pr-0 pt-4">
          <SelectionCheckbox
            checked={selected}
            onChange={onToggle}
            label={selectLabel}
          />
        </div>
      )}
      <button type="button" onClick={onOpen} className="min-h-11 min-w-11 flex-1 p-3 text-left">
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumbnail product={product} />
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-semibold text-slate-950 dark:text-white">{product.name}</div>
              <div className="mt-0.5 break-words text-xs text-slate-400">
                {product.sku}{product.categoryName ? ` · ${product.categoryName}` : ""}
              </div>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 sm:items-center">
            <p className="min-w-0 break-words text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300 sm:col-start-2 sm:row-start-1 sm:text-right">
              {priceRange(product.minRetailPrice, product.maxRetailPrice, product.retailPrice)}
            </p>
            <span className="inline-flex min-w-0 max-w-full justify-self-start break-words rounded-md bg-primary-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-primary-700 dark:bg-primary-950/60 dark:text-primary-300 sm:col-start-1 sm:row-start-1">
              {productStockDisplay(product, stockNotTrackedLabel)}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}

export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="inline-grid size-11 cursor-pointer place-items-center lg:size-4">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onClick={stopRowToggle}
        aria-label={label}
        className="h-4 w-4 rounded border-slate-300 accent-primary-600"
      />
    </label>
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

function ProductKindBadge({
  kind,
}: {
  kind: ProductRow["productKind"];
}) {
  const t = useTranslations();
  const styles = {
    product: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    service: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    combo: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  } as const;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", styles[kind])}>
      {t(`products.kind.labels.${kind}`)}
    </span>
  );
}

export function ProductDetailView({
  product,
  cameraMaterials = false,
  surface = "modal",
}: {
  product: ProductRow;
  cameraMaterials?: boolean;
  surface?: "modal" | "page";
}) {
  const t = useTranslations();
  const [tab, setTab] = useState<ProductExpandTab>("info");
  const specs = specEntries(product.specs);
  const orderNote = orderNoteFromSpecs(product.specs);
  const effectiveActive = product.isVariantParent
    ? product.children.some((child) => child.isActive)
    : product.isActive;

  if (cameraMaterials) {
    return (
      <div className={cn("bg-surface px-4 py-4", surface === "modal" && "flex h-full min-h-0 flex-col", surface === "page" && "rounded-card border border-border-soft")}>
        <div className={cn("grid gap-4 sm:grid-cols-3", surface === "modal" && "min-h-0 flex-1 overflow-y-auto")}>
          <InfoItem label={t("products.fields.sku")} value={product.sku} />
          <InfoItem label={t("products.pricing.retailPrice")} value={formatCurrency(Number(product.retailPrice))} />
          <InfoItem label={t("products.list.colUnits")} value={product.baseUnit} />
        </div>
        <ProductActionBar product={product} cameraMaterials />
      </div>
    );
  }

  return (
    <div className={cn("bg-canvas px-3 py-3 sm:bg-surface sm:px-4 sm:py-4", surface === "modal" && "flex h-full min-h-0 flex-col", surface === "page" && "sm:rounded-card sm:border sm:border-border-soft")}>
      <div className="-mx-3 flex shrink-0 snap-x snap-mandatory items-center gap-5 overflow-x-auto border-b border-border-soft bg-surface px-3 text-sm font-semibold text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-4 sm:px-4 lg:mx-0 lg:gap-6 lg:px-0">
        {PRODUCT_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "min-h-11 shrink-0 snap-start border-b-2 px-1 pt-2 transition-colors lg:min-h-0 lg:px-0 lg:pb-2 lg:pt-0 min-w-11 lg:min-w-0",
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`products.expand.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className={cn("pt-3 sm:pt-4", surface === "modal" && "min-h-0 flex-1 overflow-y-auto")}>
        {tab === "info" && (
          <ProductInfoPanel
            product={product}
            imageUrls={product.imageUrls ?? []}
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
  imageUrls,
  specs,
  effectiveActive,
}: {
  product: ProductRow;
  imageUrls: string[];
  specs: Array<readonly [string, string]>;
  effectiveActive: boolean;
}) {
  const t = useTranslations();
  const [activeImage, setActiveImage] = useState(0);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const image = imageUrls[activeImage];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[160px_1fr] lg:gap-5">
      <div className="flex flex-col items-center lg:block">
        <button
          type="button"
          onClick={() => image && setImagePreviewOpen(true)}
          disabled={!image}
          aria-label={
            image
              ? t("products.expand.imageZoom", { name: product.name })
              : undefined
          }
          className={cn(
            "group relative h-32 w-32 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:h-36 lg:w-36 lg:rounded-card lg:bg-primary-50/50 lg:shadow-none",
            image && "cursor-zoom-in transition hover:border-primary-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
          )}
        >
          {image ? (
            <>
              <Image
                src={image}
                alt={`${product.name} ${activeImage + 1}`}
                fill
                sizes="144px"
                className="object-contain p-2 transition-transform duration-200 group-hover:scale-105"
                unoptimized
              />
              <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-slate-950/70 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ZoomIn className="h-4 w-4" />
              </span>
            </>
          ) : (
            <div className="grid h-full place-items-center text-primary-300">
              <ImageIcon className="h-12 w-12" />
            </div>
          )}
        </button>
        {imageUrls.length > 1 && (
          <div className="mt-2 flex w-32 gap-1.5 overflow-x-auto pb-1 lg:w-36">
            {imageUrls.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => setActiveImage(index)}
                className={cn(
                  "relative h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-white lg:h-10 lg:w-10",
                  index === activeImage
                    ? "border-primary-600 ring-1 ring-primary-600"
                    : "border-border",
                )}
              >
                <Image src={url} alt="" fill sizes="40px" className="object-contain p-0.5" unoptimized />
              </button>
            ))}
          </div>
        )}
      </div>

      {imagePreviewOpen && image && (
        <ProductImageLightbox
          productName={product.name}
          imageUrls={imageUrls}
          activeImage={activeImage}
          onActiveImageChange={setActiveImage}
          onClose={() => setImagePreviewOpen(false)}
        />
      )}

      <div className="min-w-0 space-y-3 lg:space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-center lg:text-left">
            <h3 className="text-balance break-words text-lg font-black leading-snug text-slate-900 lg:font-bold dark:text-slate-100">
              {product.name}
            </h3>
            <div className="mt-1 text-sm text-slate-500">
              {t("products.fields.category")}: {product.categoryName ?? "—"}
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-2 lg:justify-start">
              <Badge
                text={
                  product.productKind !== "product"
                    ? t(`products.kind.labels.${product.productKind}`)
                    : product.isVariantParent
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

        <div className="grid grid-cols-2 gap-2 lg:hidden">
          <ProductMetric
            label={t("products.pricing.retailPrice")}
            value={formatCurrency(Number(product.retailPrice))}
            tone="primary"
          />
          <ProductMetric
            label={t("products.pricing.costPrice")}
            value={formatCurrency(Number(product.costPrice))}
          />
          <ProductMetric
            label={t("products.stock.current")}
            value={productStockDisplay(product, t("products.stock.notTracked"))}
            tone={
              isProductStockManaged(product.categoryName, product.productKind) &&
              Number(product.minLevel) > 0 &&
              Number(product.totalStock) <= Number(product.minLevel)
                ? "warning"
                : "success"
            }
          />
          <ProductMetric
            label={t("products.stock.min")}
            value={
              isProductStockManaged(product.categoryName, product.productKind) &&
              Number(product.minLevel) > 0
                ? formatNumber(Number(product.minLevel))
                : "—"
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-3">
          <InfoItem label={t("products.fields.sku")} value={product.sku} />
          <InfoItem
            label={t("products.fields.barcode")}
            value={product.barcode}
          />
          <InfoItem
            className="hidden lg:block"
            label={t("products.pricing.costPrice")}
            value={formatCurrency(Number(product.costPrice))}
          />
          <InfoItem
            className="hidden lg:block"
            label={t("products.pricing.retailPrice")}
            value={formatCurrency(Number(product.retailPrice))}
          />
          <InfoItem
            className="hidden lg:block"
            label={t("products.stock.current")}
            value={productStockDisplay(product, t("products.stock.notTracked"))}
          />
          <InfoItem
            className="hidden lg:block"
            label={t("products.stock.min")}
            value={
              isProductStockManaged(product.categoryName, product.productKind) && Number(product.minLevel) > 0
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

        {product.productKind === "combo" && product.comboItems.length > 0 && (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("products.combo.sectionTitle")}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {product.comboItems.map((item) => (
                <div
                  key={item.productId}
                  className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {item.name}
                    <span className="ml-1 text-xs text-slate-400">
                      {item.sku}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">
                    {formatNumber(Number(item.quantity))} {item.baseUnit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {specs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-3">
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
                  href={Routes.productDetail(child.id)}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-sm hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
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

function ProductImageLightbox({
  productName,
  imageUrls,
  activeImage,
  onActiveImageChange,
  onClose,
}: {
  productName: string;
  imageUrls: string[];
  activeImage: number;
  onActiveImageChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const hasMultipleImages = imageUrls.length > 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === "ArrowLeft" && hasMultipleImages) {
        event.preventDefault();
        onActiveImageChange(
          (activeImage - 1 + imageUrls.length) % imageUrls.length,
        );
      }
      if (event.key === "ArrowRight" && hasMultipleImages) {
        event.preventDefault();
        onActiveImageChange((activeImage + 1) % imageUrls.length);
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeImage,
    hasMultipleImages,
    imageUrls.length,
    onActiveImageChange,
    onClose,
  ]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("products.expand.imageDialog", { name: productName })}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("products.expand.imageClose")}
        autoFocus
        className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6 sm:top-6"
      >
        <X className="h-6 w-6" />
      </button>

      {hasMultipleImages && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onActiveImageChange(
              (activeImage - 1 + imageUrls.length) % imageUrls.length,
            );
          }}
          aria-label={t("products.expand.imagePrevious")}
          className="absolute left-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}

      <div
        className="relative h-[min(82dvh,900px)] w-[min(86vw,1200px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <Image
          src={imageUrls[activeImage]}
          alt={`${productName} ${activeImage + 1}`}
          fill
          sizes="86vw"
          className="object-contain"
          unoptimized
        />
      </div>

      {hasMultipleImages && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onActiveImageChange((activeImage + 1) % imageUrls.length);
          }}
          aria-label={t("products.expand.imageNext")}
          className="absolute right-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      <div className="absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-slate-950/60 px-4 py-2 text-center text-sm font-medium text-white sm:bottom-6">
        {productName}
        {hasMultipleImages && ` · ${activeImage + 1}/${imageUrls.length}`}
      </div>
    </div>,
    document.body,
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
    <>
    <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="product-stock-card">
      {movements.map((movement) => (
        <article key={movement.id} className="space-y-3 border border-border-soft p-3 first:rounded-t-card last:rounded-b-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 font-semibold"><DocumentValue movement={movement} /></div>
            <div className={cn("shrink-0 text-sm font-semibold tabular-nums", Number(movement.quantity) < 0 ? "text-er" : "text-ok")}>
              {formatSignedNumber(movement.quantity)}
            </div>
          </div>
          <div className="text-xs text-slate-500">{formatDate(movement.createdAt)} · {t(movementTypeKey(movement.type) as never)}</div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-slate-500">{t("products.expand.cols.partner")}</dt><dd className="mt-0.5 break-words">{movement.partnerName || "—"}</dd></div>
            <div><dt className="text-right text-slate-500">{t("products.expand.cols.stockAfter")}</dt><dd className="mt-0.5 text-right font-semibold tabular-nums">{formatNumber(Number(movement.stockAfter))}</dd></div>
            <div><dt className="text-slate-500">{t("products.expand.cols.transactionPrice")}</dt><dd className="mt-0.5 tabular-nums">{moneyOrDash(movement.transactionPrice)}</dd></div>
            <div><dt className="text-right text-slate-500">{t("products.expand.cols.costPrice")}</dt><dd className="mt-0.5 text-right tabular-nums">{moneyOrDash(movement.unitCost)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
    <div className="hidden overflow-x-auto lg:block">
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
    </>
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
    <>
    <div className="space-y-2 lg:hidden" data-mobile-audit="product-stock-location">
      {rows.map((row) => {
        const low = row.minLevel > 0 && row.quantity <= row.minLevel;
        return (
          <article key={row.warehouseId} className="rounded-card border border-border-soft p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="break-words font-semibold">{row.warehouseName}</div>
              <span className={cn("shrink-0 rounded-md px-2 py-1 text-xs font-semibold", effectiveActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>
                {effectiveActive ? t("products.expand.selling") : t("products.expand.stopped")}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-slate-500">{t("products.expand.cols.stock")}</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatNumber(row.quantity)}</dd></div>
              <div><dt className="text-right text-slate-500">{t("products.expand.cols.reserved")}</dt><dd className="mt-0.5 text-right font-semibold tabular-nums">{formatNumber(row.reserved)}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">{t("products.expand.cols.daysToOut")}</dt><dd className={cn("mt-0.5", low ? "font-semibold text-warn" : "text-slate-500")}>{low ? t("products.expand.lowStock") : "—"}</dd></div>
            </dl>
          </article>
        );
      })}
    </div>
    <div className="hidden overflow-x-auto lg:block">
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
    </>
  );
}

function RelatedProductsPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const rows = product.relatedProducts;

  if (rows.length === 0)
    return <EmptyPanel message={t("products.expand.relatedEmpty")} />;

  return (
    <>
    <div className="space-y-2 lg:hidden" data-mobile-audit="product-related">
      {rows.map((item) => (
        <article key={item.id} className="rounded-card border border-border-soft p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={Routes.productDetail(item.id)}
              className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {item.sku}
            </Link>
            <div className="shrink-0 font-semibold tabular-nums">{formatCurrency(Number(item.retailPrice))}</div>
          </div>
          <div className="break-words font-medium">{item.name}</div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-slate-500">{t("products.expand.cols.costPrice")}</dt><dd className="mt-0.5 tabular-nums">{formatCurrency(Number(item.costPrice))}</dd></div>
            <div><dt className="text-right text-slate-500">{t("products.expand.cols.stock")}</dt><dd className="mt-0.5 text-right tabular-nums">{productStockDisplay({ ...item, categoryName: product.categoryName }, t("products.stock.notTracked"))}</dd></div>
            <div><dt className="text-slate-500">{t("products.expand.cols.reserved")}</dt><dd className="mt-0.5 tabular-nums">{isProductStockManaged(product.categoryName) ? formatNumber(Number(item.reservedStock)) : "—"}</dd></div>
            <div><dt className="text-right text-slate-500">{t("products.expand.cols.vat")}</dt><dd className="mt-0.5 text-right">{t("products.expand.notTaxed")}</dd></div>
          </dl>
        </article>
      ))}
    </div>
    <div className="hidden overflow-x-auto lg:block">
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
                  href={Routes.productDetail(item.id)}
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
    </>
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
      <OrderDetailLink
        orderId={movement.refId}
        className="inline-flex min-h-11 min-w-11 items-center text-primary-600 hover:underline lg:min-h-0 lg:min-w-0"
      >
        {label}
      </OrderDetailLink>
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
  const [morePosition, setMorePosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const effectiveActive = product.isVariantParent
    ? product.children.some((child) => child.isActive)
    : product.isActive;
  const nextActive = !effectiveActive;
  const sameTypeSourceId = product.parentProductId ?? product.id;

  const updateMorePosition = useCallback(() => {
    const trigger = moreButtonRef.current?.getBoundingClientRect();
    const menu = moreMenuRef.current?.getBoundingClientRect();
    if (!trigger || !menu) return;
    setMorePosition(
      positionFloatingMenu({
        trigger,
        menu,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (moreOpen) updateMorePosition();
  }, [moreOpen, updateMorePosition]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !moreButtonRef.current?.contains(target) &&
        !moreMenuRef.current?.contains(target)
      ) {
        setMoreOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMorePosition);
    window.addEventListener("scroll", updateMorePosition, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMorePosition);
      window.removeEventListener("scroll", updateMorePosition, true);
    };
  }, [moreOpen, updateMorePosition]);

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
    sp.delete("detailProductId");
    if (pathname.startsWith("/products/")) {
      router.replace(`${Routes.Inventory}?tab=products`);
      return;
    }
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
    sp.delete("detailProductId");
    for (const [key, value] of Object.entries(patch)) sp.set(key, value);
    return `${Routes.Inventory}?${sp.toString()}`;
  }

  return (
    <div className="border-t border-border-soft pt-4">
      <div className={cn(
        cameraMaterials
          ? "flex"
          : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]",
        "gap-2 lg:flex lg:flex-wrap lg:justify-end",
      )}>
        {cameraMaterials ? (
          <ActionButton
            icon={Trash2}
            label={locale === "vi" ? "Xóa khỏi vật tư lắp camera" : "Remove from camera materials"}
            onClick={toggleCameraMaterial}
            disabled={pending}
            tone="danger"
          />
        ) : (
          <>
            <ActionLink
              icon={Copy}
              label={t("products.actions.copy")}
              className="hidden lg:inline-flex"
              href={productModalHref({
                productModal: "copy",
                copyFrom: product.id,
              })}
            />
          <ActionLink
            icon={Pencil}
            label={t("products.actions.edit")}
            href={
              pathname.startsWith("/products/")
                ? `${Routes.productDetail(product.id)}?edit=1`
                : productModalHref({
                    productModal: "edit",
                    productId: product.id,
                  })
            }
            replace={pathname.startsWith("/products/")}
            tone="primary"
          />
          <ActionLink
            icon={PackagePlus}
            label={t("products.actions.purchase")}
            href={Routes.purchaseNewForProduct(product.id)}
          />
          <div className="relative">
            <button
              ref={moreButtonRef}
              type="button"
              aria-label={locale === "vi" ? "Thao tác khác" : "More actions"}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              className={cn(actionClassName, "w-11 border-border bg-surface px-0 text-slate-700 hover:bg-surface-2 dark:text-slate-200")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={moreMenuRef}
                role="menu"
                style={
                  morePosition
                    ? {
                        left: morePosition.left,
                        top: morePosition.top,
                        maxHeight: morePosition.maxHeight,
                      }
                    : { left: 0, top: 0, visibility: "hidden" }
                }
                className="fixed z-[100] min-w-52 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl"
              >
                  <MenuActionLink
                    icon={Copy}
                    label={t("products.actions.copy")}
                    href={productModalHref({
                      productModal: "copy",
                      copyFrom: product.id,
                    })}
                    className="lg:hidden"
                  />
                  {ONLINE_SALES_ENABLED && (
                    <MenuActionLink
                      icon={Store}
                      label={locale === "vi" ? "Đăng sàn" : "List online"}
                      href={productModalHref({ onlineProductId: product.id })}
                    />
                  )}
                  <MenuActionLink icon={Barcode} label={t("products.actions.printLabels")} href={Routes.productLabels(product.id)} />
                  <MenuActionLink
                    icon={Plus}
                    label={t("products.actions.addSameType")}
                    href={productModalHref({ productModal: "sameType", sameTypeAs: sameTypeSourceId })}
                  />
                  <MenuActionButton
                    icon={PackagePlus}
                    label={locale === "vi" ? "Thêm vào vật tư lắp camera" : "Add to camera materials"}
                    onClick={toggleCameraMaterial}
                    disabled={pending}
                  />
                  <div className="my-1 border-t border-border-soft" />
                  <MenuActionButton
                    icon={Ban}
                    label={t(
                      (nextActive
                        ? "products.actions.resumeSelling"
                        : "products.actions.stopSelling") as never,
                    )}
                    onClick={toggleActive}
                    disabled={pending}
                  />
                  <MenuActionButton
                    icon={Trash2}
                    label={t("products.actions.delete")}
                    onClick={removeProduct}
                    disabled={pending}
                    tone="danger"
                  />
              </div>,
              document.body,
            )}
          </div>
          </>
        )}
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
  replace = false,
  className,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone?: "neutral" | "primary";
  replace?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      replace={replace}
      className={cn(
        actionClassName,
        tone === "primary"
          ? "border-primary-600 bg-primary-600 text-white hover:border-primary-700 hover:bg-primary-700"
          : "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
        className,
        "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
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
  className,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn(
      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface-2 dark:text-slate-200 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
      className,
      "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
    )}>
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function MenuActionButton({
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
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium disabled:pointer-events-none disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
        tone === "danger"
          ? "text-er hover:bg-red-50 dark:hover:bg-red-950/30"
          : "text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
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
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 lg:h-10 min-w-11 lg:min-w-0";

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

function ProductMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "success" | "warning";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border-soft bg-surface px-3 py-3 shadow-sm">
      <div className="truncate text-[10px] font-semibold text-slate-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-sm font-black tabular-nums text-slate-800 dark:text-slate-100",
          tone === "primary" && "text-primary-700 dark:text-primary-300",
          tone === "success" && "text-ok",
          tone === "warning" && "text-warn",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function InfoItem({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-surface px-3 py-2.5 shadow-sm lg:rounded-none lg:border-b lg:border-border-soft lg:bg-transparent lg:px-0 lg:pb-2 lg:pt-0 lg:shadow-none", className)}>
      <div className="truncate text-[10px] font-semibold text-slate-400 lg:text-xs lg:font-normal lg:text-slate-500">{label}</div>
      <div className="mt-1 min-h-5 break-words text-sm font-semibold text-slate-800 lg:font-medium dark:text-slate-100">
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
