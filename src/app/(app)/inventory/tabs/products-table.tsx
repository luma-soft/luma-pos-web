"use client";

import {
  matchesInventoryProductSearch,
  matchesProductVariant,
  productDisplayName,
  productVariantLabel,
  selectableProductIds,
  formatVariantOptionSummary,
  formatVariantPriceRange,
  variantOptionSummary,
} from "@/lib/products/variant-presentation";
import { productMatchesSelectionStatus } from "@/lib/product-catalog-explorer";
import { legacyText } from "@/lib/i18n/catalog-text";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { selectAllInputOnClick } from "@/lib/input-selection";
import {
  Ban,
  Barcode,
  Package,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageIcon,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Store,
  Tag,
  Trash2,
  X,
  ZoomIn,
  type LucideIcon,
  Layers,
} from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { AutoLinkText } from "@/components/ui/auto-link-text";
import { Select } from "@/components/ui/select";
import {
  DataTableShell,
  stopRowToggle,
  type DataTableColumn,
} from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { OrderDetailLink } from "@/components/order-detail-link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { deleteProduct, setProductActive } from "@/lib/actions/products";
import { setCameraMaterial } from "@/lib/actions/products";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { modalActionSizeClassName } from "@/components/ui/button-variants";
import { positionFloatingMenu } from "@/lib/floating-menu-position";
import type { ProductListResult } from "@/lib/data/products";
import {
  projectProductUnit,
  type ProductListUnit,
} from "@/lib/product-unit-projection";
import {
  isProductStockManaged,
  productStockDisplay,
} from "@/lib/product-stock";
import { useProductSelection } from "./product-selection";
import { MobileSelectionIndicator } from "@/components/mobile-ui";
import { useLongPress } from "@/components/use-long-press";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { MobileDetailNav } from "@/components/mobile-detail-nav";
import { MenuAction as MobileMenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import {
  checkStockHistoryVersionOnce,
  fetchStockHistoryOnce,
  readCachedStockHistory,
} from "@/lib/offline/product-stock-history-store";
import { resolveProductStockHistoryPanelState } from "@/lib/product-stock-history-state";

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

function unitProjection(product: ProductRow, selectedUnitName: string) {
  return projectProductUnit({
    baseUnit: product.baseUnit,
    costPrice: product.costPrice,
    retailPrice: product.retailPrice,
    totalStock: product.totalStock,
    reservedStock: product.reservedStock,
    minLevel: product.minLevel,
    unitDefinitions: product.unitDefinitions,
    selectedUnitName,
  });
}

function selectedUnitDefinition(
  product: ProductRow,
  selectedUnitName: string,
) {
  return product.unitDefinitions.find(
    (unit) => unit.unitName === selectedUnitName,
  );
}

export function buildProductUnitColumns({
  labels,
  selectedUnitName,
  onUnitChange,
  grouped = false,
}: {
  labels: {
    units: string;
    cost: string;
    salePrice: string;
    stock: string;
    stockNotTracked: string;
  };
  selectedUnitName: (product: ProductRow) => string;
  onUnitChange: (product: ProductRow, unitName: string) => void;
  grouped?: boolean;
}): DataTableColumn<ProductRow>[] {
  const projection = (product: ProductRow) =>
    unitProjection(product, selectedUnitName(product));

  const costRange = (product: ProductRow) => {
    if (grouped && product.variantGroup) return formatVariantPriceRange(product.variantGroup.minCostPrice, product.variantGroup.maxCostPrice);
    const projected = projection(product);
    if (!product.isVariantParent) return formatCurrency(projected.costPrice);
    return priceRange(
      Number(product.minCostPrice) * projected.multiplier,
      Number(product.maxCostPrice) * projected.multiplier,
      projected.costPrice,
    );
  };

  const retailRange = (product: ProductRow) => {
    if (grouped && product.variantGroup) return formatVariantPriceRange(product.variantGroup.minRetailPrice, product.variantGroup.maxRetailPrice);
    const selectedName = selectedUnitName(product);
    const projected = unitProjection(product, selectedName);
    if (!product.isVariantParent) return formatCurrency(projected.retailPrice);

    const unit = selectedUnitDefinition(product, selectedName);
    if (
      unit?.priceOverride !== null
      && unit?.priceOverride !== undefined
      && Number.isFinite(Number(unit.priceOverride))
    ) {
      return formatCurrency(projected.retailPrice);
    }

    return priceRange(
      Number(product.minRetailPrice) * projected.multiplier,
      Number(product.maxRetailPrice) * projected.multiplier,
      projected.retailPrice,
    );
  };

  return [
    {
      key: "units",
      width: "86px",
      label: labels.units,
      defaultVisible: true,
      render: (product) => grouped && product.variantGroup ? (
        <span className="text-slate-500">{product.variantGroup.totalStock === null ? "Nhiều đơn vị" : product.baseUnit}</span>
      ) : (
        <ProductUnitSelector
          productName={productDisplayName(product)}
          baseUnit={product.baseUnit}
          units={product.unitDefinitions}
          value={projection(product).unitName}
          onChange={(unitName) => onUnitChange(product, unitName)}
        />
      ),
    },
    {
      key: "cost",
      width: "135px",
      label: labels.cost,
      defaultVisible: true,
      align: "right",
      cellClassName: "!overflow-visible !whitespace-normal tabular-nums",
      render: costRange,
      sortValue: (product) =>
        grouped && product.variantGroup
          ? Number(product.variantGroup.minCostPrice)
          : product.isVariantParent
          ? Number(product.minCostPrice) * projection(product).multiplier
          : projection(product).costPrice,
    },
    {
      key: "salePrice",
      width: "145px",
      label: labels.salePrice,
      defaultVisible: true,
      align: "right",
      cellClassName: "font-semibold !overflow-visible !whitespace-normal tabular-nums",
      render: retailRange,
      sortValue: (product) => {
        const selectedName = selectedUnitName(product);
        const projected = unitProjection(product, selectedName);
        const unit = selectedUnitDefinition(product, selectedName);
        const hasOverride =
          unit?.priceOverride !== null
          && unit?.priceOverride !== undefined
          && Number.isFinite(Number(unit.priceOverride));
        return grouped && product.variantGroup
          ? Number(product.variantGroup.minRetailPrice)
          : product.isVariantParent && !hasOverride
          ? Number(product.minRetailPrice) * projected.multiplier
          : projected.retailPrice;
      },
    },
    {
      key: "stock",
      width: "100px",
      label: labels.stock,
      defaultVisible: true,
      align: "right",
      cellClassName: (product) => {
        if (!isProductStockManaged(product.categoryName, product.productKind)) {
          return "font-medium text-slate-400";
        }
        const projected = projection(product);
        return projected.minLevel > 0
          && projected.totalStock <= projected.minLevel
          ? "font-semibold text-er"
          : "font-semibold text-slate-700 dark:text-slate-300";
      },
      render: (product) => {
        if (grouped && product.variantGroup) {
          return <span className="block whitespace-normal"><span className="block text-[10px] font-normal text-slate-500">Tổng tồn</span>{product.variantGroup.totalStock === null ? "Khác đơn vị" : `${formatNumber(Number(product.variantGroup.totalStock))} ${product.baseUnit}`}</span>;
        }
        const projected = projection(product);
        return productStockDisplay(
          {
            ...product,
            totalStock: projected.totalStock,
            baseUnit: projected.unitName,
          },
          labels.stockNotTracked,
        );
      },
      sortValue: (product) => grouped && product.variantGroup
        ? Number(product.variantGroup.totalStock ?? Number.POSITIVE_INFINITY)
        : projection(product).totalStock,
    },
  ];
}

function groupActionHref(groupId: string, action: "copy" | "groupAdd" | "groupEdit", currentQuery = "") {
  const params = new URLSearchParams(currentQuery);
  for (const key of ["productModal", "productId", "copyFrom", "copyGroup", "sameTypeAs", "detailProductId", "detailTab"]) params.delete(key);
  params.set("tab", "products");
  params.set("productModal", action);
  params.set(action === "copy" ? "copyFrom" : action === "groupEdit" ? "productId" : "sameTypeAs", groupId);
  if (action === "copy") params.set("copyGroup", "1");
  return `${Routes.Inventory}?${params.toString()}`;
}

export function ProductsTable({
  rows,
  resetScrollKey,
  queryOverride,
  selectionEnabled = true,
  grouped = true,
  empty,
}: {
  rows: ProductListResult["rows"];
  resetScrollKey?: string | number;
  queryOverride?: string;
  selectionEnabled?: boolean;
  grouped?: boolean;
  empty?: ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const { selectedIds, selectedVisibleIds, allSelected, toggle, toggleMany, toggleAll } =
    useProductSelection();
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [allVariants, setAllVariants] = useState<Record<string, boolean>>({});
  // Phones enter selection mode with a long press, as on iOS; desktop keeps checkboxes.
  const [mobileSelecting, setMobileSelecting] = useState(false);
  const mobileSelection = selectionEnabled && mobileSelecting;
  const query = queryOverride ?? params.get("q") ?? "";
  const expansionStorageKey = `luma:products:variants:${resetScrollKey ?? "default"}`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = JSON.parse(sessionStorage.getItem(expansionStorageKey) ?? "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          setExpandedGroups(Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")));
        }
      } catch { /* Expansion state is an optional preference. */ }
    });
    return () => { active = false; };
  }, [expansionStorageKey]);

  const groupOf = (product: ProductRow) => grouped ? product.variantGroup : undefined;
  const isExpanded = (product: ProductRow) => {
    const group = groupOf(product);
    return expandedGroups[product.id]
      ?? Boolean(query.trim() && group?.members.some((member) => matchesInventoryProductSearch(member, query)));
  };
  function matchesStatus(member: ProductRow) {
    const status = params.get("status") || "active";
    return productMatchesSelectionStatus(member, status as "active" | "inactive" | "draft" | "archived" | "all");
  }
  const selectionIds = (product: ProductRow) => {
    const group = groupOf(product);
    return group ? group.members.filter(matchesStatus).map((member) => member.id) : selectableProductIds(product, grouped);
  };
  const selected = (product: ProductRow) => {
    const ids = selectionIds(product);
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  };
  const partiallySelected = (product: ProductRow) => !selected(product)
    && selectionIds(product).some((id) => selectedIds.has(id));
  const toggleProduct = (product: ProductRow) => toggleMany(selectionIds(product));

  function toggleGroup(product: ProductRow) {
    const next = { ...expandedGroups, [product.id]: !isExpanded(product) };
    setExpandedGroups(next);
    try { sessionStorage.setItem(expansionStorageKey, JSON.stringify(next)); } catch { /* Optional preference. */ }
  }

  function membersFor(product: ProductRow) {
    const group = groupOf(product);
    let members = (group?.members ?? []).filter(matchesStatus);
    if (query.trim()) {
      members = members.filter((member) => matchesInventoryProductSearch(member, query));
    }
    return { members: allVariants[product.id] ? members : members.slice(0, 8), total: members.length };
  }

  function groupControls(product: ProductRow) {
    const group = groupOf(product);
    if (!group) return null;
    const { total, members } = membersFor(product);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 lg:px-4 lg:py-3" onClick={stopRowToggle}>
        <Link href={groupActionHref(group.id, "copy", params.toString())} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200">
          <Copy className="h-4 w-4" />{t("products.actions.copy")}
        </Link>
        {members.length < total && <button type="button" onClick={() => setAllVariants((current) => ({ ...current, [product.id]: true }))} className="min-h-11 text-sm font-semibold text-primary-600 hover:underline dark:text-primary-300">{t("products.variants.showAll", { count: total })}</button>}
        {allVariants[product.id] && total > 8 && <button type="button" onClick={() => setAllVariants((current) => ({ ...current, [product.id]: false }))} className="min-h-11 text-sm font-semibold text-primary-600 hover:underline dark:text-primary-300">{t("products.variants.showLess")}</button>}
        <Link href={groupActionHref(group.id, "groupAdd", params.toString())} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 lg:ml-auto lg:w-auto">
          <Plus className="h-4 w-4 shrink-0" />{t("products.actions.addSameType")}
        </Link>
      </div>
    );
  }

  const selectedUnitName = (product: ProductRow) =>
    selectedUnits[product.id] ?? product.baseUnit;

  const changeUnit = (productId: string, unitName: string) => {
    setSelectedUnits((current) => ({ ...current, [productId]: unitName }));
  };

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
          checked={selected(product)}
          indeterminate={partiallySelected(product)}
          onChange={() => toggleProduct(product)}
          label={t("products.bulk.selectProduct", {
            name: product.name,
          })}
        />
      ),
    } satisfies DataTableColumn<ProductRow>] : []),
    {
      key: "sku",
      label: t("products.expand.cols.sku"),
      required: true,
      width: "260px",
      cellClassName: "!whitespace-normal !overflow-visible",
      render: (product) => (
        <div className="flex items-center gap-2.5">
          <ProductThumbnail product={product} />
          <div className="min-w-0">
            {groupOf(product) && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); toggleGroup(product); }}
                aria-expanded={isExpanded(product)}
                aria-label={t(isExpanded(product) ? "products.variants.collapse" : "products.variants.expand", { count: groupOf(product)!.count, name: product.name })}
                className="mb-1 block rounded-sm text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
              >
                {t("products.variants.groupCode", { count: groupOf(product)!.count })}
              </button>
            )}
            <div className={cn("break-words", groupOf(product) ? "text-xs text-slate-500" : "font-medium")}>{product.sku}</div>
            {product.barcode && <div className="mt-0.5 break-all text-xs text-slate-400">{product.barcode}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "product",
      label: t("products.expand.cols.name"),
      required: true,
      wrap: true,
      cellClassName: "!whitespace-normal",
      render: (product) => {
        const group = groupOf(product);
        const summary = group ? formatVariantOptionSummary(variantOptionSummary(group.members)) : "";
        return <div className="space-y-1">
          <div className="break-words font-medium text-slate-900 dark:text-slate-100">{group?.name ?? productDisplayName(product, " - ")}</div>
          {summary && <div className="line-clamp-2 break-words text-xs text-slate-500" title={summary}>{summary}</div>}
          {!group && <ProductKindBadge kind={product.productKind} />}
        </div>;
      },
    },
    { key: "category", label: t("products.list.colCategory"), defaultVisible: false, width: "130px", render: (product) => <span className="text-slate-500">{product.categoryName ?? "—"}</span> },
    ...buildProductUnitColumns({
      labels: {
        units: t("products.list.colUnits"),
        cost: t("products.list.colCost"),
        salePrice: t("products.list.colSalePrice"),
        stock: t("products.list.colStock"),
        stockNotTracked: t("products.stock.notTracked"),
      },
      selectedUnitName,
      onUnitChange: (product, unitName) => changeUnit(product.id, unitName),
      grouped,
    }),
    { key: "status", label: t("products.list.colStatus"), defaultVisible: true, width: "112px", render: (product) => groupOf(product) ? <span className="text-xs text-slate-500">{t("products.variants.activeCount", { count: groupOf(product)!.members.filter((member) => member.isActive).length })}</span> : <StatusBadge product={product} /> },
  ];

  return (
    <>
      {mobileSelection && rows.length > 0 && (
        <ProductMobileSelectionToolbar
          doneLabel={t("mobile.invoices.selectDone")}
          onDone={() => {
            setMobileSelecting(false);
            if (selectedVisibleIds.length > 0) toggleMany(selectedVisibleIds);
          }}
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
        resetScrollKey={resetScrollKey}
        empty={empty}
        mobileListClassName="-mx-4 !space-y-0 border-t border-border bg-surface"
        mobileRowClassName="!rounded-none !border-0"
        onRowClick={(product) => groupOf(product) ? toggleGroup(product) : openProduct(product)}
        rowClickColumnKey="product"
        rowClassName={(product) => cn(
          groupOf(product) && "bg-primary-50/60 hover:bg-primary-50 [&>td:last-child]:bg-primary-50/60 dark:bg-primary-950/40 dark:hover:bg-primary-950/60 dark:[&>td:last-child]:bg-primary-950/40",
          groupOf(product) && isExpanded(product) && "[&>td]:border-t [&>td]:border-primary-600 [&>td:first-child]:border-l [&>td:last-child]:border-r",
          selected(product) && "bg-primary-100/50 dark:bg-primary-950/60",
        )}
        renderFollowingRows={(product, visibleColumns) => {
          if (!groupOf(product) || !isExpanded(product)) return null;
          const { members } = membersFor(product);
          return <Fragment>
            {members.map((member) => {
              const child: ProductRow = { ...member, variantGroup: undefined };
              return <tr key={`${product.id}:${child.id}`} className={cn("border-t border-border-soft bg-surface hover:bg-surface-2 [&>td:first-child]:border-l [&>td:first-child]:border-primary-600 [&>td:last-child]:border-r [&>td:last-child]:border-primary-600", selectedIds.has(child.id) && "bg-primary-50 dark:bg-primary-950/40")}>
                {visibleColumns.map((column) => <td key={column.key} className={cn("px-3 py-3 align-middle", column.align === "right" && "text-right tabular-nums", column.align === "center" && "text-center", typeof column.cellClassName === "function" ? column.cellClassName(child) : column.cellClassName)}>
                  {column.key === "sku" ? <Link href={Routes.productDetail(child.id)} scroll={false} onClick={stopRowToggle} className="flex min-h-14 items-center gap-2.5 text-sm font-medium hover:text-primary-600"><ProductThumbnail product={child} /><span className="min-w-0 break-words">{child.sku}</span></Link>
                    : column.key === "product" ? <Link href={Routes.productDetail(child.id)} scroll={false} onClick={stopRowToggle} className="block whitespace-normal font-medium hover:text-primary-600">
                      <span className="block break-words">{productDisplayName(child, " - ")}</span>
                      <span className="mt-1 block"><ProductKindBadge kind={child.productKind} /></span>
                    </Link>
                    : column.render(child)}
                </td>)}
              </tr>;
            })}
            <tr className="bg-surface"><td colSpan={visibleColumns.length} className="border-x border-b border-primary-600 border-t border-t-border-soft">{groupControls(product)}</td></tr>
          </Fragment>;
        }}
        renderMobileRow={({ row: product }) => {
          const group = groupOf(product);
          const enterSelection = selectionEnabled ? () => {
            setMobileSelecting(true);
            if (!selected(product)) toggleProduct(product);
          } : undefined;
          if (!group) return <ProductMobileRow product={product} selectionEnabled={mobileSelection} selected={selected(product)} selectLabel={t("products.bulk.selectProduct", { name: product.name })} stockNotTrackedLabel={t("products.stock.notTracked")} selectedUnitName={selectedUnitName(product)} onUnitChange={(unitName) => changeUnit(product.id, unitName)} onToggle={() => toggleProduct(product)} onOpen={() => openProduct(product)} onLongPress={enterSelection} />;
          const expanded = isExpanded(product);
          return <div>
            {/* Native variant-group row: tinted, "N mã hàng ›", from-price and total stock. */}
            <div className={cn("flex min-w-0 items-center gap-3 border-b border-border bg-primary-600/[0.08] pl-ios-inset", selected(product) && "bg-primary-600/[0.14]")}>
              {mobileSelection && <MobileSelectionIndicator selected={selected(product)} label={t("products.bulk.selectProduct", { name: product.name })} onToggle={() => toggleProduct(product)} />}
              <ProductGroupMobileButton
                product={product}
                name={group.name}
                countLabel={t("products.variants.count", { count: membersFor(product).total })}
                priceLabel={formatVariantPriceRange(group.minRetailPrice, group.maxRetailPrice)}
                summaryLabel={formatVariantOptionSummary(variantOptionSummary(group.members), 3, { compact: true })}
                stockLabel={`${t("products.variants.totalStock")}: ${group.totalStock === null ? t("products.variants.multipleUnits") : `${formatNumber(Number(group.totalStock))} ${product.baseUnit}`}`}
                expanded={expanded}
                onToggle={mobileSelection ? () => toggleProduct(product) : () => toggleGroup(product)}
                onLongPress={enterSelection}
              />
            </div>
            {expanded && <>
              <div>
                {membersFor(product).members.map((member) => <ProductMobileRow key={member.id} product={{ ...member, variantGroup: undefined }} variantRow selectionEnabled={mobileSelection} selected={selectedIds.has(member.id)} selectLabel={t("products.bulk.selectProduct", { name: member.name })} stockNotTrackedLabel={t("products.stock.notTracked")} selectedUnitName={selectedUnitName(member)} onUnitChange={(unitName) => changeUnit(member.id, unitName)} onToggle={() => toggle(member.id)} onOpen={() => openProduct(member)} />)}
              </div>
              <div className="border-b border-border">{groupControls(product)}</div>
            </>}
          </div>;
        }}
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
  doneLabel,
  onDone,
}: {
  checked: boolean;
  indeterminate: boolean;
  selectedCount: number;
  selectAllLabel: string;
  selectedLabel: string;
  onToggleAll: () => void;
  doneLabel?: string;
  onDone?: () => void;
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
      {onDone && doneLabel && (
        <button type="button" onClick={onDone} className="ml-auto min-h-11 px-2 text-[17px] font-semibold text-ios-accent">
          {doneLabel}
        </button>
      )}
    </div>
  );
}

export function ProductUnitSelector({
  productName,
  baseUnit,
  units,
  value,
  onChange,
}: {
  productName: string;
  baseUnit: string;
  units: readonly ProductListUnit[];
  value: string;
  onChange: (unitName: string) => void;
}) {
  const options = buildProductUnitOptions(baseUnit, units);

  if (options.length <= 1) {
    return <span className="text-slate-500">{options[0]?.label ?? baseUnit}</span>;
  }

  return (
    <div
      onClick={stopRowToggle}
      onPointerDown={stopRowToggle}
      onKeyDown={stopRowToggle}
      className="inline-block max-w-full"
    >
      <Select
        value={value}
        options={options}
        onValueChange={onChange}
        aria-label={`Đơn vị tính ${productName}`}
        size="sm"
        menuMinWidth={160}
        rootClassName="max-w-full"
        className="max-w-full text-slate-600 dark:text-slate-300"
      />
    </div>
  );
}

export function buildProductUnitOptions(
  baseUnit: string,
  units: readonly ProductListUnit[],
) {
  const seen = new Set<string>();
  return [baseUnit, ...units.map((unit) => unit.unitName)]
    .filter((unitName) => {
      if (seen.has(unitName)) return false;
      seen.add(unitName);
      return true;
    })
    .map((unitName) => ({ value: unitName, label: unitName }));
}

export function ProductMobileRow({
  product,
  selectionEnabled,
  selected,
  selectLabel,
  stockNotTrackedLabel,
  selectedUnitName,
  onUnitChange,
  onToggle,
  onOpen,
  onLongPress,
  groupSummary = false,
  variantRow = false,
}: {
  product: ProductRow;
  selectionEnabled: boolean;
  selected: boolean;
  selectLabel: string;
  stockNotTrackedLabel: string;
  selectedUnitName: string;
  onUnitChange: (unitName: string) => void;
  onToggle: () => void;
  onOpen: () => void;
  onLongPress?: () => void;
  groupSummary?: boolean;
  variantRow?: boolean;
}) {
  const t = useTranslations();
  const longPress = useLongPress(onLongPress);
  const displayName = productDisplayName(product, " - ");
  const projected = unitProjection(product, selectedUnitName);
  const unitOptions = buildProductUnitOptions(product.baseUnit, product.unitDefinitions);
  const selectedUnit = selectedUnitDefinition(product, selectedUnitName);
  const hasRetailOverride =
    selectedUnit?.priceOverride !== null
    && selectedUnit?.priceOverride !== undefined
    && Number.isFinite(Number(selectedUnit.priceOverride));
  const group = groupSummary ? product.variantGroup : undefined;
  const retailDisplay = group ? formatVariantPriceRange(group.minRetailPrice, group.maxRetailPrice) : product.isVariantParent && !hasRetailOverride
    ? priceRange(
        Number(product.minRetailPrice) * projected.multiplier,
        Number(product.maxRetailPrice) * projected.multiplier,
        projected.retailPrice,
      )
    : formatCurrency(projected.retailPrice);
  const stockDisplay = group
    ? group.totalStock === null ? t("products.variants.multipleUnits") : `${formatNumber(Number(group.totalStock))} ${product.baseUnit}`
    : productStockDisplay(
        { ...product, totalStock: projected.totalStock, baseUnit: projected.unitName },
        stockNotTrackedLabel,
      );
  const tracked = stockDisplay !== stockNotTrackedLabel;
  const stockTone = nativeStockTone(tracked, Number(projected.totalStock), Number(projected.minLevel));

  // NativeProductRow: thumbnail, 17pt name, SKU and group, then price, unit and "On hand" on the right.
  return (
    // Full-bleed hairline on the row itself, like iOS list rows.
    <div className={cn("flex min-w-0 items-center gap-3 border-b border-border", variantRow ? "pl-8" : "pl-ios-inset", selected && "bg-primary-600/[0.06]")}>
      {selectionEnabled && (
        <MobileSelectionIndicator selected={selected} label={selectLabel} onToggle={onToggle} />
      )}
      <div className="relative min-h-[94px] min-w-0 flex-1 py-ios-row pr-ios-inset">
        {/* One hit target for the row; the unit selector takes precedence. */}
        <button
          type="button"
          onClick={() => {
            if (longPress.consumeClick()) return;
            if (selectionEnabled) onToggle();
            else onOpen();
          }}
          {...longPress.handlers}
          aria-label={displayName}
          className="absolute inset-0 -left-ios-inset [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ios-accent active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        />
        <div className="pointer-events-none relative flex min-w-0 items-center gap-3">
          <ProductThumbnail product={product} largeOnMobile tone={stockTone} />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 break-words text-[17px] font-semibold leading-[22px] text-ios-label">
              {displayName}
            </div>
            <div className="mt-1 truncate text-[15px] leading-5 text-ios-label-secondary">{product.sku || "—"}</div>
            {!variantRow && product.categoryName && (
              <div className="mt-0.5 truncate text-[15px] leading-5 text-ios-label-secondary">{product.categoryName}</div>
            )}
            {variantRow && (
              <div className="mt-0.5 truncate text-[13px] text-ios-label-secondary">
                {t("products.list.colCost")}: {formatCurrency(projected.costPrice)}
              </div>
            )}
          </div>
          <div className="flex min-w-[90px] max-w-[43%] shrink-0 flex-col items-end gap-1.5 self-stretch text-right">
            <div className="max-w-full break-words text-[17px] font-semibold leading-[22px] tabular-nums text-ios-label">
              {retailDisplay}
            </div>
            {!group && unitOptions.length > 1 ? (
              <div className="pointer-events-auto relative z-10 max-w-full">
                <ProductUnitSelector
                  productName={displayName}
                  baseUnit={product.baseUnit}
                  units={product.unitDefinitions}
                  value={projected.unitName}
                  onChange={onUnitChange}
                />
              </div>
            ) : (
              <span className="truncate text-[15px] text-ios-label-secondary">{projected.unitName}</span>
            )}
            <span className={cn(
              "mt-auto max-w-full break-words text-[17px] leading-[22px]",
              tracked ? NATIVE_STOCK_TEXT[stockTone] : "text-ios-label-secondary",
            )}>
              {!tracked ? stockDisplay : projected.totalStock === 0 ? t("mobile.products.stockOut") : t("mobile.inventory.onHand", { stock: stockDisplay })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductGroupMobileButton({
  product,
  name,
  countLabel,
  priceLabel,
  summaryLabel,
  stockLabel,
  expanded,
  onToggle,
  onLongPress,
}: {
  product: ProductRow;
  name: string;
  countLabel: string;
  priceLabel: string;
  summaryLabel?: string;
  stockLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onLongPress?: () => void;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={() => { if (!longPress.consumeClick()) onToggle(); }}
      {...longPress.handlers}
      aria-expanded={expanded}
      className="flex min-h-[94px] min-w-0 flex-1 items-center gap-3 py-ios-row pr-ios-inset text-left [-webkit-touch-callout:none] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <ProductThumbnail product={product} largeOnMobile />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-[17px] font-semibold leading-[22px] text-ios-label">{name}</span>
        {summaryLabel && <span className="mt-1 block truncate text-[15px] leading-5 text-ios-label-secondary">{summaryLabel}</span>}
        <span className="mt-1 inline-flex items-center gap-1 text-[17px] text-ios-accent">
          {countLabel}
          <ChevronRight className={cn("size-[17px] transition-transform", expanded && "rotate-90")} strokeWidth={2.5} aria-hidden="true" />
        </span>
      </span>
      <span className="flex max-w-[40%] shrink-0 flex-col items-end gap-1.5 self-stretch text-right">
        <span className="text-[17px] font-semibold leading-[22px] tabular-nums text-ios-label">{priceLabel}</span>
        <span className="text-[15px] leading-5 text-ios-label-secondary">{stockLabel}</span>
      </span>
    </button>
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
      <Checkbox
        ref={ref}
        checked={checked}
        onChange={onChange}
        onClick={stopRowToggle}
        aria-label={label}
        className="h-4 w-4"
      />
    </label>
  );
}

/** iOS NativeInventoryFormatting.currency: "200.000đ". */
function formatNativeCurrency(value: number) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)}đ`;
}

/** Up to this many SKUs, the detail shows every option as a chip instead of a dropdown. */
const VARIANT_CHIP_LIMIT = 12;

/** NativeProductStockPresentation: tone of a product's stock on phones. */
type NativeStockTone = "information" | "critical" | "warning" | "positive";
function nativeStockTone(tracked: boolean, stock: number, minimum: number): NativeStockTone {
  if (!tracked) return "information";
  if (stock <= 0) return "critical";
  if (minimum === 0) return "positive";
  if (minimum < 0 || stock * 2 <= minimum) return "critical";
  if (stock <= minimum) return "warning";
  return "positive";
}
const NATIVE_STOCK_TEXT: Record<NativeStockTone, string> = {
  information: "text-ios-accent",
  critical: "text-ios-red",
  warning: "text-ios-orange",
  positive: "text-ios-green",
};
const NATIVE_STOCK_PILL: Record<NativeStockTone, string> = {
  information: "bg-ios-accent/12 text-ios-accent",
  critical: "bg-ios-red/12 text-ios-red",
  warning: "bg-ios-orange/12 text-ios-orange",
  positive: "bg-ios-green/12 text-ios-green",
};

function ProductThumbnail({ product, largeOnMobile = false, tone }: { product: ProductRow; largeOnMobile?: boolean; tone?: NativeStockTone }) {
  const image = Array.isArray(product.imageUrls) && typeof product.imageUrls[0] === "string"
    ? product.imageUrls[0]
    : null;
  return (
    <div className={cn(
      "relative shrink-0 overflow-hidden rounded-lg border border-border-soft bg-white dark:bg-slate-900",
      largeOnMobile ? "h-16 w-16 max-lg:rounded-[14px] max-lg:border-ios-stroke/40 max-lg:bg-surface-2 lg:h-11 lg:w-11" : "h-11 w-11",
    )}>
      {image ? (
        <Image
          src={image}
          alt={productDisplayName(product)}
          fill
          sizes={largeOnMobile ? "(max-width: 1023px) 64px, 44px" : "44px"}
          className="object-contain p-1"
          unoptimized
        />
      ) : (
        <div className="grid h-full place-items-center text-slate-300 dark:text-slate-600">
          <ImageIcon className={cn("h-5 w-5", largeOnMobile && "max-lg:hidden")} />
          {largeOnMobile && <Tag className={cn("size-6 -rotate-45 lg:hidden", tone ? NATIVE_STOCK_TEXT[tone] : "text-primary-600/50")} strokeWidth={1.8} aria-hidden="true" />}
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
  const router = useRouter();
  const params = useSearchParams();
  const initialTab = params.get("detailTab") as ProductExpandTab;
  const variantPickerId = useId();
  const [tab, setTab] = useState<ProductExpandTab>(PRODUCT_EXPAND_TABS.includes(initialTab) ? initialTab : "info");
  const group = product.variantGroup;
  const needsVariant = Boolean(group && product.isVariantParent);
  const specs = specEntries(product.specs);
  const orderNote = orderNoteFromSpecs(product.specs);
  // Keep the current layout while the next SKU loads: the chip changes at once and the
  // panels below dim in place instead of swapping to a different loading layout.
  const [switchingVariant, startVariantSwitch] = useTransition();
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);
  const activeVariantId = switchingVariant && pendingVariantId ? pendingVariantId : needsVariant ? null : product.id;
  const selectVariant = (id: string) => {
    if (id === activeVariantId) return;
    setPendingVariantId(id);
    startVariantSwitch(() => router.replace(`${Routes.productDetail(id)}?detailTab=${tab}`, { scroll: false }));
  };
  const variantBusyClass = switchingVariant && "pointer-events-none animate-pulse opacity-60 transition-opacity";
  const variantPicker = group ? (
    group.count <= VARIANT_CHIP_LIMIT ? (
            <div role="radiogroup" aria-labelledby={variantPickerId} className="flex w-full min-w-0 flex-wrap gap-2 lg:max-w-3xl lg:flex-1">
              {group.members.map((member) => {
                const active = member.id === activeVariantId;
                return <button
                  key={member.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={`${member.sku} · ${formatCurrency(Number(member.retailPrice))}`}
                  onClick={() => selectVariant(member.id)}
                  className={cn(
                    "min-h-11 max-w-full break-words rounded-lg border px-3.5 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 lg:min-h-9",
                    active
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-border bg-surface text-slate-700 hover:border-primary-400 dark:text-slate-200",
                    !member.isActive && !active && "text-slate-400 line-through decoration-slate-300 dark:text-slate-500",
                  )}
                >{productVariantLabel(member)}</button>;
              })}
            </div>
          ) : (
          <Select
            id={variantPickerId}
            value={activeVariantId ?? ""}
            options={group.members.map((member) => ({
              value: member.id,
              label: `${productVariantLabel(member)} · ${member.sku}`,
              description: `${formatCurrency(Number(member.retailPrice))} · ${t("products.variants.stock", { stock: productStockDisplay(member, t("products.stock.notTracked")) })}`,
            }))}
            searchable={group.count > 8}
            searchPlaceholder={t("products.variants.search")}
            placeholder={t("products.variants.choose")}
            wrapLabel
            rootClassName="w-full min-w-0 lg:max-w-3xl lg:flex-1"
            className="min-h-16 py-3 font-medium aria-expanded:border-primary-600 lg:min-h-16"
            optionClassName="min-h-16 py-3 lg:min-h-16"
            onValueChange={selectVariant}
          />
          )
  ) : null;
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
    <div className={cn("bg-canvas px-3 py-3 sm:bg-surface sm:px-4 sm:py-4 max-lg:px-0 max-lg:pt-0", surface === "modal" && "flex h-full min-h-0 flex-col", surface === "page" && "sm:rounded-card sm:border sm:border-border-soft")}>
      {/* Phones: ProductDetailView's navigation bar, with every action in the "…" sheet. */}
      <div className="shrink-0 lg:hidden">
        <MobileDetailNav
          title={t("mobile.products.title")}
          actions={<ProductActionBar product={product} variant="menu" />}
        />
      </div>
      {group && <div className="mb-4 shrink-0 border-b border-border-soft pb-4 max-lg:hidden">
        <div className="mb-2 flex items-center justify-between gap-3">
          {group.count <= VARIANT_CHIP_LIMIT
            ? <span id={variantPickerId} className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("products.variants.version")}</span>
            : <label htmlFor={variantPickerId} className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("products.variants.version")}</label>}
          <span className="text-xs text-slate-500">{t("products.variants.count", { count: group.count })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:gap-6">
          {variantPicker}
          <Link href={groupActionHref(group.id, "groupEdit", params.toString())} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold text-primary-600 hover:underline dark:text-primary-300"><Pencil className="h-4 w-4" />{t("products.variants.editGroup")}</Link>
        </div>
        {needsVariant && <p className="mt-2 text-xs text-slate-500">{t("products.variants.chooseHint")}</p>}
      </div>}
      <div className="-mx-3 flex shrink-0 snap-x snap-mandatory items-center gap-[22px] max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:mx-0 max-lg:scroll-px-4 max-lg:px-ios-inset overflow-x-auto border-b border-border-soft bg-surface px-4 text-sm font-semibold text-slate-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-4 sm:px-4 lg:mx-0 lg:gap-6 lg:px-0">
        {PRODUCT_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            disabled={needsVariant && (key === "stock" || key === "stockCard")}
            className={cn(
              "min-h-[46px] min-w-11 shrink-0 snap-start border-b-[3px] px-1 pt-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0 lg:min-w-0 lg:border-b-2 lg:px-0 lg:pb-2 lg:pt-0",
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`products.expand.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className={cn("pt-3 sm:pt-4 max-lg:pt-0", surface === "modal" && "min-h-0 flex-1 overflow-y-auto")}>
        {/* Phones: compact summary and variant chips scroll with the tab content, like iOS. */}
        <div className="lg:hidden">
          <div aria-busy={switchingVariant || undefined} className={cn(variantBusyClass)}><ProductMobileHero product={product} /></div>
          {group && <div className="bg-surface px-ios-inset pb-3.5">
            <p id={group.count <= VARIANT_CHIP_LIMIT ? undefined : `${variantPickerId}-hint`} className="mb-2 text-[12px] text-ios-label-secondary">{t("mobile.products.chooseVariantHint")}</p>
            {variantPicker}
          </div>}
          <div className="h-px bg-border-soft" />
        </div>
        <div aria-busy={switchingVariant || undefined} className={cn("max-lg:px-3", variantBusyClass)}>
        {tab === "info" && (
          <ProductInfoPanel
            key={product.id}
            product={product}
            imageUrls={product.imageUrls ?? []}
            specs={specs}
            effectiveActive={effectiveActive}
          />
        )}
        {tab === "description" && (
          <ProductDescriptionPanel product={product} orderNote={orderNote} />
        )}
        {tab === "stockCard" && !needsVariant && <ProductStockCardPanel key={product.id} product={product} />}
        {tab === "stock" && !needsVariant && (
          <ProductStockPanel
            product={product}
            effectiveActive={effectiveActive}
          />
        )}
        {needsVariant && (tab === "stock" || tab === "stockCard") && <EmptyPanel message="Chọn một biến thể để xem tồn kho và lịch sử của SKU đó." />}
        {tab === "related" && <RelatedProductsPanel product={product} />}
        </div>
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
      <div className="flex flex-col items-center max-lg:hidden lg:block">
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
                alt={`${productDisplayName(product)} ${activeImage + 1}`}
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
          productName={productDisplayName(product)}
          imageUrls={imageUrls}
          activeImage={activeImage}
          onActiveImageChange={setActiveImage}
          onClose={() => setImagePreviewOpen(false)}
        />
      )}

      <div className="min-w-0 lg:space-y-4">
        <div className="flex items-start justify-between gap-3 max-lg:hidden">
          <div className="min-w-0 flex-1 text-center lg:text-left">
            <h3 className="text-balance break-words text-lg font-black leading-snug text-slate-900 lg:font-bold dark:text-slate-100">
              {productDisplayName(product)}
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

        <div className="-mx-3 grid grid-cols-3 divide-x divide-border-soft border-b border-border-soft bg-surface py-1 lg:hidden">
          <ProductMetric
            label={t("mobile.products.retailPrice")}
            value={formatNativeCurrency(Number(product.retailPrice))}
            tone="primary"
          />
          <ProductMetric
            label={t("products.pricing.costPrice")}
            value={formatNativeCurrency(Number(product.costPrice))}
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
        </div>

        <ProductMobileInfo product={product} specs={specs} />
        <div className="grid grid-cols-2 gap-2 max-lg:hidden lg:grid-cols-4 lg:gap-x-8 lg:gap-y-3">
          <InfoItem label={t("products.fields.sku")} value={product.sku} />
          <InfoItem className="lg:hidden"
            label={t("products.stock.min")}
            value={isProductStockManaged(product.categoryName, product.productKind) && Number(product.minLevel) > 0
              ? formatNumber(Number(product.minLevel)) : "—"}
          />
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
                    {productDisplayName(item)}
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
          <div className="grid grid-cols-2 gap-2 max-lg:hidden lg:grid-cols-4 lg:gap-x-8 lg:gap-y-3">
            {specs.map(([key, value]) => (
              <InfoItem key={key} label={key} value={value} />
            ))}
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
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6 sm:top-6"
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

      <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-slate-950/60 px-4 py-2 text-center text-sm font-medium text-white sm:bottom-6">
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
      <AutoLinkText
        className={cn(
          "mt-4 block min-h-7 whitespace-pre-wrap text-sm",
          muted
            ? "text-center text-slate-400"
            : "text-slate-700 dark:text-slate-200",
        )}
      >
        {value}
      </AutoLinkText>
    </section>
  );
}

function ProductStockCardPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const { snapshot } = useProductCatalog();
  const [page, setPage] = useState(1);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const appliedRefreshSequence = useRef(0);
  const [history, setHistory] = useState<{
    scopeId: string;
    productId: string;
    page: number;
    rows: StockMovementRow[];
    hasMore: boolean;
  } | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "offline" | "error">("loading");
  const tracked = isProductStockManaged(product.categoryName);
  const scopeId = snapshot?.scopeId;
  // A catalog revision prompts a cheap stock-history check, not a reload of
  // the entire history. The cached history itself has its own product version.
  const revision = snapshot?.revision;

  useEffect(() => {
    if (!tracked) return;
    let cancelled = false;
    const forceReload = appliedRefreshSequence.current !== refreshSequence;
    appliedRefreshSequence.current = refreshSequence;

    void (async () => {
      // Defer UI state updates until after the effect has subscribed.
      await Promise.resolve();
      if (cancelled) return;
      if (!scopeId || !revision) {
        if (!cancelled) setLoadState("offline");
        return;
      }
      const cached = await readCachedStockHistory(scopeId, product.id, page);
      if (cancelled) return;
      if (!cached) {
        setHistory(null);
        setLoadState("loading");
      } else {
        setHistory({ scopeId, productId: product.id, page, rows: cached.rows, hasMore: cached.hasMore });
        setLoadState("ready");
      }
      if (!navigator.onLine) {
        if (!cached) setLoadState("offline");
        return;
      }
      try {
        if (cached && !forceReload) {
          const currentVersion = await checkStockHistoryVersionOnce(scopeId, product.id);
          if (cancelled || cached.version === currentVersion) return;
        }
        const result = await fetchStockHistoryOnce(scopeId, product.id, page);
        if (cancelled) return;
        if (result.ok) {
          setHistory({ scopeId, productId: product.id, page, rows: result.data.rows, hasMore: result.data.hasMore });
          setLoadState("ready");
        } else if (!cached) {
          setLoadState("error");
        }
      } catch {
        if (!cancelled && !cached) setLoadState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [scopeId, revision, product.id, page, refreshSequence, tracked]);

  useEffect(() => {
    const refreshAfterReconnect = () => setRefreshSequence((current) => current + 1);
    window.addEventListener("online", refreshAfterReconnect);
    return () => window.removeEventListener("online", refreshAfterReconnect);
  }, []);

  if (!tracked)
    return <EmptyPanel message={t("products.stock.notTracked")} />;

  // A scope/product/page switch must not display rows cached for the previous
  // actor or product while asynchronous IndexedDB hydration is in progress.
  const visibleHistory = history !== null && history.scopeId === scopeId
    && history.productId === product.id && history.page === page ? history : null;
  const panelState = resolveProductStockHistoryPanelState(
    visibleHistory,
    { scopeId, productId: product.id, page },
    loadState,
  );
  if (panelState === "offline-unavailable") {
    return (
      <div>
        <EmptyPanel message="Lịch sử Thẻ kho chưa được tải trên thiết bị này. Hãy kết nối mạng rồi thử lại." />
        <button type="button" className="mt-3 rounded-md border border-border-soft px-3 py-2 text-sm" onClick={() => setRefreshSequence((current) => current + 1)}>Thử lại</button>
      </div>
    );
  }
  if (panelState === "error") {
    return (
      <div>
        <EmptyPanel message="Không tải được lịch sử Thẻ kho. Kiểm tra kết nối hoặc quyền truy cập." />
        <button type="button" className="mt-3 rounded-md border border-border-soft px-3 py-2 text-sm" onClick={() => setRefreshSequence((current) => current + 1)}>Thử lại</button>
      </div>
    );
  }
  if (panelState === "loading" || !visibleHistory) {
    return <div role="status" className="p-4 text-sm text-muted-foreground">Đang tải lịch sử Thẻ kho…</div>;
  }

  const movements = visibleHistory.rows;
  if (panelState === "empty")
    return <EmptyPanel message={t("products.expand.stockCardEmpty")} />;

  return (
    <>
    {/* Phones: NativeProductStockCardTab — current stock heading and plain movement rows. */}
    <div className="lg:hidden" data-mobile-audit="product-stock-card">
      <p className="pb-3 pt-2 text-[17px] font-semibold">
        {product.sku} · {t("mobile.products.currentStock")}: {formatNumber(Number(product.totalStock))}
      </p>
      <div className="divide-y divide-border-soft">
        {movements.map((movement) => {
          const quantity = Number(movement.quantity);
          return (
            <article key={movement.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[15px] font-semibold">{t(movementTypeKey(movement.type) as never)}</div>
                <div className="line-clamp-2 text-[15px] text-ios-label-secondary">
                  {formatDate(movement.createdAt)} · <DocumentValue movement={movement} />
                </div>
              </div>
              <div className="shrink-0 space-y-1 text-right">
                <div className={cn("text-[15px] font-bold tabular-nums", quantity < 0 ? "text-ios-orange" : "text-ios-green")}>
                  {formatSignedNumber(movement.quantity)}
                </div>
                {movement.stockAfter != null && (
                  <div className="text-[15px] tabular-nums text-ios-label-secondary">{t("mobile.products.stockAfter")}: {formatNumber(Number(movement.stockAfter))}</div>
                )}
              </div>
            </article>
          );
        })}
      </div>
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
                <PartnerDetailLink kind={movement.refType === "purchase" ? "supplier" : "customer"} partnerId={movement.partnerId} name={movement.partnerName || "—"} openInCurrentTab />
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
    <div className="mt-4 flex items-center justify-end gap-3 text-sm">
      <button type="button" className="mr-auto rounded-md border border-border-soft px-3 py-2" onClick={() => setRefreshSequence((current) => current + 1)}>Làm mới Thẻ kho</button>
      <button
        type="button"
        className="rounded-md border border-border-soft px-3 py-2 disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => setPage((current) => Math.max(1, current - 1))}
      >
        Trang trước
      </button>
      <span className="tabular-nums">Trang {page}</span>
      <button
        type="button"
        className="rounded-md border border-border-soft px-3 py-2 disabled:opacity-40"
        disabled={!visibleHistory.hasMore}
        onClick={() => setPage((current) => current + 1)}
      >
        Trang sau
      </button>
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

  const rows = [
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
    {/* Phones: NativeProductInventoryTab — stock cells and the level bar. */}
    <ProductMobileInventory product={product} />
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
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

function VariantGroupPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const params = useSearchParams();
  const group = product.variantGroup!;
  const router = useRouter();
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string>>({});
  return <section className="overflow-hidden rounded-xl border border-primary-500">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-50/60 px-4 py-3 dark:bg-primary-950/40"><h3 className="text-sm font-semibold">{t("products.expand.tabs.related")}</h3><span className="text-xs text-primary-700 dark:text-primary-300">{t("products.variants.count", { count: group.count })}</span></div>
    <div className="lg:hidden">
      {group.members.map((member) => <div key={member.id} className={cn(member.id === product.id && "bg-primary-50/40 dark:bg-primary-950/40")}>
        {member.id === product.id && <div className="px-3 pt-2 text-xs font-semibold text-primary-600">{t("products.variants.selected")}</div>}
        <ProductMobileRow product={{ ...member, name: productVariantLabel(member), variantGroup: undefined }} variantRow selectionEnabled={false} selected={false} selectLabel="" stockNotTrackedLabel={t("products.stock.notTracked")} selectedUnitName={selectedUnits[member.id] ?? member.baseUnit} onUnitChange={(unit) => setSelectedUnits((current) => ({ ...current, [member.id]: unit }))} onToggle={() => {}} onOpen={() => { router.replace(`${Routes.productDetail(member.id)}?detailTab=related`, { scroll: false }); }} />
      </div>)}
    </div>
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="border-y border-border-soft bg-surface-2 text-xs text-slate-500"><tr>
          <th className="px-4 py-3 text-left font-semibold">{t("products.expand.cols.sku")}</th>
          <th className="px-4 py-3 text-left font-semibold">{t("products.variants.version")}</th>
          <th className="px-4 py-3 text-right font-semibold">{t("products.list.colCost")}</th>
          <th className="px-4 py-3 text-right font-semibold">{t("products.list.colSalePrice")}</th>
          <th className="px-4 py-3 text-right font-semibold">{t("products.list.colStock")}</th>
        </tr></thead>
        <tbody className="divide-y divide-border-soft">{group.members.map((member) => <tr key={member.id} className={cn("hover:bg-surface-2", member.id === product.id && "bg-primary-50/40 dark:bg-primary-950/40")}>
          <td className="px-4 py-3"><Link href={`${Routes.productDetail(member.id)}?detailTab=related`} scroll={false} className="flex min-h-12 items-center gap-3 font-medium text-primary-700 hover:underline dark:text-primary-300"><ProductThumbnail product={member} />{member.sku}</Link></td>
          <td className="px-4 py-3"><span className="block font-medium">{productVariantLabel(member)}</span>{member.id === product.id && <span className="mt-1 block text-xs text-primary-600">{t("products.variants.selected")}</span>}</td>
          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatCurrency(Number(member.costPrice))}</td>
          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatCurrency(Number(member.retailPrice))}</td>
          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{productStockDisplay(member, t("products.stock.notTracked"))}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft p-3 lg:px-4">
      <Link href={groupActionHref(group.id, "copy", params.toString())} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary-700 dark:text-primary-300"><Copy className="h-4 w-4" />{t("products.actions.copy")}</Link>
      <Link href={groupActionHref(group.id, "groupAdd", params.toString())} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 lg:w-auto"><Plus className="h-4 w-4" />{t("products.actions.addSameType")}</Link>
    </div>
  </section>;
}

function RelatedProductsPanel({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const rows = (product.variantGroup?.members ?? product.relatedProducts)
    .filter((member) => matchesProductVariant(member, search, { includeProductName: false }));

  if (product.variantGroup) return <VariantGroupPanel product={product} />;

  if (product.relatedProducts.length === 0)
    return <EmptyPanel message={t("products.expand.relatedEmpty")} />;

  return (
    <>
    <div className="relative mb-3 max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} onClick={selectAllInputOnClick} placeholder="Tìm SKU hoặc thuộc tính" aria-label="Tìm trong các biến thể" className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary-600 lg:h-10" /></div>
    {rows.length === 0 && <EmptyPanel message="Không tìm thấy biến thể." />}
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
          <div className="break-words font-medium">{productVariantLabel(item)}</div>
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
                {productVariantLabel(item)}
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

function ProductActionBar({ product, cameraMaterials = false, variant = "bar" }: { product: ProductRow; cameraMaterials?: boolean; variant?: "bar" | "menu" }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const catalog = useProductCatalog();
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
  const moreCloseTimer = useRef<number | null>(null);
  const effectiveActive = product.isVariantParent
    ? product.children.some((child) => child.isActive)
    : product.isActive;
  const nextActive = !effectiveActive;
  const sameTypeSourceId = product.variantGroup?.id ?? product.parentProductId ?? product.id;

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

  useEffect(() => () => {
    if (moreCloseTimer.current !== null) window.clearTimeout(moreCloseTimer.current);
  }, []);

  function supportsHover() {
    return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function openMoreOnHover() {
    if (!supportsHover()) return;
    if (moreCloseTimer.current !== null) window.clearTimeout(moreCloseTimer.current);
    setMoreOpen(true);
  }

  function closeMoreAfterHover() {
    if (!supportsHover()) return;
    if (moreCloseTimer.current !== null) window.clearTimeout(moreCloseTimer.current);
    moreCloseTimer.current = window.setTimeout(() => setMoreOpen(false), 120);
  }

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
      if (res.ok) {
        await catalog.refresh();
        clearExpandedAndRefresh();
      } else setError(t(res.error as never));
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
    sp.delete("copyGroup");
    sp.delete("sameTypeAs");
    sp.delete("onlineProductId");
    sp.delete("shopeeProductId");
    sp.delete("detailProductId");
    for (const [key, value] of Object.entries(patch)) sp.set(key, value);
    return `${Routes.Inventory}?${sp.toString()}`;
  }

  if (variant === "menu") {
    // Phones: the native "Thao tác khác" sheet (edit, purchase, copy, labels, manage variants, same type, stop, delete).
    const go = (href: string) => router.push(href);
    return (
      <div className="space-y-2">
        <MobileMenuAction icon={Pencil} label={t("mobile.products.edit")} onSelect={() => go(
          pathname.startsWith("/products/")
            ? `${Routes.productDetail(product.id)}?edit=1`
            : productModalHref({ productModal: product.isVariantParent ? "groupEdit" : "edit", productId: product.id }),
        )} />
        {!product.isVariantParent && <MobileMenuAction icon={PackagePlus} label={t("mobile.products.purchase")} onSelect={() => go(Routes.purchaseNewForProduct(product.id))} />}
        <MobileMenuAction icon={Copy} label={t("mobile.products.copy")} onSelect={() => go(productModalHref({ productModal: "copy", copyFrom: product.id }))} />
        {!product.isVariantParent && <MobileMenuAction icon={Barcode} label={t("mobile.products.printLabels")} onSelect={() => go(Routes.productLabels(product.id))} />}
        {product.variantGroup && <MobileMenuAction icon={Layers} label={t("mobile.products.manageVariants")} onSelect={() => go(productModalHref({ productModal: "variants", productId: product.variantGroup!.id }))} />}
        <MobileMenuAction icon={Plus} label={t("mobile.products.addSameType")} onSelect={() => go(productModalHref({ productModal: product.variantGroup ? "groupAdd" : "sameType", sameTypeAs: sameTypeSourceId }))} />
        <MobileMenuAction icon={Ban} label={t(nextActive ? "mobile.products.resumeSelling" : "mobile.products.stopSelling")} disabled={pending} onSelect={() => void toggleActive()} />
        <MobileMenuAction icon={Trash2} label={t("mobile.products.delete")} destructive disabled={pending} onSelect={() => void removeProduct()} />
        {error && <p className="text-sm font-medium text-er">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-t border-border-soft pt-4 max-lg:hidden">
      <div className={cn(
        cameraMaterials
          ? "flex"
          : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]",
        "gap-2 lg:flex lg:flex-wrap lg:justify-end",
      )}>
        {cameraMaterials ? (
          <ActionButton
            icon={Trash2}
            label={legacyText(locale, "d0d8a15eb7df")}
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
            // The editor shares this URL path with the detail (`?edit=1`). A prefetch of it is
            // cached as the detail view, so clicking would change the URL but keep the detail.
            prefetch={false}
            href={
              pathname.startsWith("/products/")
                ? `${Routes.productDetail(product.id)}?edit=1`
                : productModalHref({
                    productModal: product.isVariantParent ? "groupEdit" : "edit",
                    productId: product.id,
                  })
            }
            tone="primary"
          />
          {!product.isVariantParent && <ActionLink
            icon={PackagePlus}
            label={t("products.actions.purchase")}
            href={Routes.purchaseNewForProduct(product.id)}
            target="_blank"
          />}
          {product.isVariantParent && <ActionLink icon={Plus} label={t("products.actions.addSameType")} href={productModalHref({ productModal: "groupAdd", sameTypeAs: sameTypeSourceId })} />}
          <div className="relative">
            <button
              ref={moreButtonRef}
              type="button"
              aria-label={legacyText(locale, "df4a04789361")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
              onMouseEnter={openMoreOnHover}
              onMouseLeave={closeMoreAfterHover}
              className={cn(actionClassName, "w-11 border-border bg-surface px-0 text-slate-700 hover:bg-surface-2 dark:text-slate-200")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen && typeof document !== "undefined" && createPortal(
              <div
                ref={moreMenuRef}
                role="menu"
                onMouseEnter={openMoreOnHover}
                onMouseLeave={closeMoreAfterHover}
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
                      label={legacyText(locale, "89a329ca46b4")}
                      href={productModalHref({ onlineProductId: product.id })}
                    />
                  )}
                  {!product.isVariantParent && <MenuActionLink icon={Barcode} label={t("products.actions.printLabels")} href={Routes.productLabels(product.id)} />}
                  <MenuActionLink
                    icon={Plus}
                    label={t("products.actions.addSameType")}
                    href={productModalHref({ productModal: product.variantGroup ? "groupAdd" : "sameType", sameTypeAs: sameTypeSourceId })}
                  />
                  <MenuActionButton
                    icon={PackagePlus}
                    label={legacyText(locale, "3f95e66a40a5")}
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
  prefetch,
  className,
  target,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone?: "neutral" | "primary";
  replace?: boolean;
  prefetch?: false;
  className?: string;
  target?: "_blank";
}) {
  return (
    <Link
      href={href}
      replace={replace}
      prefetch={prefetch}
      target={target}
      rel={target ? "noreferrer" : undefined}
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
  `inline-flex ${modalActionSizeClassName} shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 min-w-11 lg:min-w-0`;

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
    // Phone-only metric row (ProductDetailView): large value above a secondary label.
    <div className="flex min-w-0 flex-col-reverse bg-surface px-2 py-3 text-center">
      <div className="mt-1 text-[15px] leading-5 text-ios-label-secondary">
        {label}
      </div>
      <div
        className={cn(
          "break-words text-[19px] font-bold leading-6 tabular-nums text-ios-label [overflow-wrap:anywhere]",
          tone === "primary" && "text-ios-accent",
          tone === "success" && "text-ios-green",
          tone === "warning" && "text-ios-orange",
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
      <AutoLinkText className="mt-1 block min-h-5 break-words text-sm font-semibold text-slate-800 lg:font-medium dark:text-slate-100">
        {value || "—"}
      </AutoLinkText>
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

/** ProductDetailView header on phones: image (or placeholder) beside name, SKU, stock pill, category. */
function ProductMobileHero({ product }: { product: ProductRow }) {
  const t = useTranslations();
  const image = product.imageUrls?.[0];
  const imageCount = product.imageUrls?.length ?? 0;
  const tracked = isProductStockManaged(product.categoryName, product.productKind);
  const stock = Number(product.totalStock);
  const tone = NATIVE_STOCK_PILL[nativeStockTone(tracked, stock, Number(product.minLevel))];
  // ProductDetailView.compactHero: 76pt image, name, "SKU · category", stock pill.
  return (
    <div className="flex items-start gap-3.5 bg-surface px-ios-inset py-3.5">
      <div className="relative grid size-[76px] shrink-0 place-items-center overflow-hidden rounded-[12px] border border-border-soft bg-canvas">
        {image ? (
          <Image src={image} alt={productDisplayName(product)} fill sizes="76px" className="object-contain p-1" unoptimized />
        ) : (
          <Package className="size-[26px] text-ios-accent" strokeWidth={1.8} aria-label={t("mobile.products.noImage")} />
        )}
        {imageCount > 1 && <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-px text-[11px] font-bold text-white">+{imageCount - 1}</span>}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <h2 className="line-clamp-2 text-[17px] font-bold leading-[22px] [overflow-wrap:anywhere]">{productDisplayName(product)}</h2>
        <p className="truncate text-[15px] text-ios-label-secondary">{[product.sku || "—", product.categoryName].filter(Boolean).join(" · ")}</p>
        <span className={cn("inline-flex rounded-full px-2 py-[3px] text-[13px] font-semibold leading-[18px]", tone)}>
          {!tracked ? t("products.stock.notTracked") : stock === 0 ? t("mobile.products.stockOut") : t("mobile.products.stockLeft", { stock: productStockDisplay(product, t("products.stock.notTracked")) })}
        </span>
      </div>
    </div>
  );
}

/** Phone sections of the info tab: "Thông tin cơ bản" and "Đơn vị & bảng giá" as plain labelled rows. */
function ProductMobileInfo({ product, specs }: { product: ProductRow; specs: ReadonlyArray<readonly [string, string]> }) {
  const t = useTranslations();
  const tracked = isProductStockManaged(product.categoryName, product.productKind);
  const row = (label: string, value: string | null | undefined, tone?: string) => (
    <div key={label} className="flex min-h-[38px] items-center justify-between gap-4 border-b border-border-soft px-ios-inset py-2 text-[15px] font-medium">
      <span className="shrink-0 text-[#596170] dark:text-ios-label-secondary">{label}</span>
      <span className={cn("min-w-0 text-right [overflow-wrap:anywhere]", tone ?? "text-ios-label")}>{value || "–"}</span>
    </div>
  );
  return (
    <div className="-mx-3 bg-surface lg:hidden">
      <h3 className="flex min-h-[42px] items-center border-b border-border-soft px-ios-inset text-[17px] font-extrabold">{t("mobile.products.basicInfo")}</h3>
      {row(t("mobile.products.sku"), product.sku)}
      {row(t("mobile.products.barcode"), product.barcode)}
      {row(t("mobile.products.category"), product.categoryName)}
      {row(t("mobile.products.brand"), product.brandName)}
      {row(t("mobile.products.location"), product.location)}
      {tracked && Number(product.minLevel) > 0 && row(t("mobile.products.minStock"), formatNumber(Number(product.minLevel)))}
      {Number(product.weight) > 0 ? row(t("mobile.products.weight"), formatNumber(Number(product.weight))) : null}
      {product.dimensions ? row(t("mobile.products.dimensions"), product.dimensions) : null}
      <h3 className="flex min-h-[42px] items-center border-b border-border-soft px-ios-inset text-[17px] font-extrabold">{t("mobile.products.unitsAndPrices")}</h3>
      <div className="mx-ios-inset my-3 flex items-center justify-between gap-3 rounded-[16px] bg-black/[0.04] px-4 py-3 dark:bg-white/[0.06]">
        <span>
          <span className="block text-[17px] font-semibold">{t("mobile.products.baseUnit")}</span>
          <span className="block text-[13px] text-ios-label-secondary">{t("mobile.products.baseUnitHint")}</span>
        </span>
        <span className="text-[17px] text-ios-label-secondary">{product.baseUnit}</span>
      </div>
      {row(t("mobile.products.costPrice"), formatNativeCurrency(Number(product.costPrice)), "font-extrabold text-ios-accent")}
      {row(t("mobile.products.retailPrice"), formatNativeCurrency(Number(product.retailPrice)), "font-extrabold text-ios-accent")}
      {specs.length > 0 && (
        <>
          <h3 className="flex min-h-[42px] items-center border-b border-border-soft px-ios-inset text-[17px] font-extrabold">{t("mobile.products.attributes")}</h3>
          {specs.map(([key, value]) => row(key.toLocaleUpperCase("vi"), value))}
        </>
      )}
    </div>
  );
}

/** NativeProductInventoryTab on phones: 2×2 stock cells and a progress bar toward the minimum. */
function ProductMobileInventory({ product }: { product: ProductRow }) {
  const t = useTranslations("mobile.products");
  const stock = Number(product.totalStock);
  const minimum = Number(product.minLevel);
  const tone = nativeStockTone(true, stock, minimum);
  const ratio = minimum > 0 ? stock / minimum : 1;
  const progress = Math.min(1, Math.max(0, ratio > 1 ? ratio / 2 : ratio));
  const cell = (label: string, value: string, tint?: string) => (
    <div className="min-h-[68px] rounded-[14px] bg-surface p-3">
      <div className="truncate text-[11px] font-bold uppercase text-ios-label-secondary">{label}</div>
      <div className={cn("mt-1 truncate text-[15px] font-bold tabular-nums", tint)}>{value}</div>
    </div>
  );
  const barTone = { information: "bg-ios-accent", critical: "bg-ios-red", warning: "bg-ios-orange", positive: "bg-ios-green" }[tone];
  return (
    <div className="space-y-3 py-5 lg:hidden" data-mobile-audit="product-stock-location">
      <div className="grid grid-cols-2 gap-2.5">
        {cell(t("onHand"), `${formatNumber(stock)} ${product.baseUnit}`, NATIVE_STOCK_TEXT[tone])}
        {cell(t("minimum"), `${formatNumber(minimum)} ${product.baseUnit}`)}
        {cell(t("reserved"), `${formatNumber(Number(product.reservedStock ?? 0))} ${product.baseUnit}`)}
        {cell(t("location"), product.location?.trim() || "–")}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]" role="progressbar" aria-label={t("stock")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className={cn("h-full rounded-full", barTone)} style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
