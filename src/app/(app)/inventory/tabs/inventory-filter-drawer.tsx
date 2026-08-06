"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  collectFocusableElements,
  LumaDateRangePicker,
  LumaEntityPicker,
  LumaWebPicker,
  type EntityPickerKind,
} from "../../sales/tabs/filter-drawer-shared";
import {
  ORDER_TIME_PRESETS,
  isOrderDateRangeValid,
  resolveOrderTimePreset,
} from "@/lib/orders/filter-date-range";
import { Toggle } from "@/components/ui/toggle";

type Option = { value: string; label: string };
type Field =
  | "category"
  | "status"
  | "view"
  | "warehouse"
  | "supplier"
  | "stock"
  | "time"
  | "debt"
  | "reason"
  | "department"
  | "brand"
  | "kind"
  | "sort";

type FilterDraft = Record<Field | "from" | "to", string>;

type Props = {
  title: string;
  values: Record<string, string | undefined>;
  fields: Field[];
  resultCount?: number;
  resultLabel?: string;
  countEndpoint?: string;
  categories?: Option[];
  warehouses?: Option[];
  suppliers?: Option[];
  brands?: Option[];
  reasons?: Option[];
  departments?: Option[];
};

const all = { value: "", label: "Tất cả" };
const productStatuses = [
  all,
  { value: "active", label: "Đang kinh doanh" },
  { value: "inactive", label: "Ngừng kinh doanh" },
  { value: "draft", label: "Nháp" },
];
const purchaseStatuses = [
  all,
  { value: "received", label: "Đã nhập kho" },
  { value: "draft", label: "Chờ nhập kho" },
  { value: "returned", label: "Đã trả hàng" },
  { value: "cancelled", label: "Đã hủy" },
];
const stockOptions = [
  all,
  { value: "instock", label: "Còn hàng" },
  { value: "low", label: "Sắp hết" },
  { value: "out", label: "Hết hàng" },
];

export function InventoryFilterDrawer({
  title,
  values,
  fields,
  resultCount: initialResultCount,
  resultLabel = "sản phẩm",
  countEndpoint,
  categories = [],
  warehouses = [],
  suppliers = [],
  brands = [],
  reasons = [],
  departments = [],
}: Props) {
  const router = useRouter();
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const isPurchaseFilter = title.includes("phiếu nhập");
  const isInternalUseFilter = fields.includes("reason");
  const internalUseStatuses = [
    all,
    { value: "approved", label: t("internalUse.status.approved") },
    { value: "pending", label: t("internalUse.status.pending") },
  ];

  const initial = useMemo<FilterDraft>(
    () => ({
      category: values.category ?? "",
      status: values.status ?? "",
      view: values.view ?? "grouped",
      warehouse: values.warehouseId ?? values.warehouse ?? "",
      supplier: values.supplierId ?? "",
      stock: values.stock ?? "",
      time: values.timePreset ?? "all",
      from: values.from ?? "",
      to: values.to ?? "",
      debt: values.debtOnly ?? "",
      reason: values.reason ?? "",
      department: values.department ?? "",
      brand: values.brandId ?? "",
      kind: values.productKind ?? "",
      sort: values.sort ?? "",
    }),
    [values],
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [entityLabels, setEntityLabels] = useState<Record<string, string>>({});
  const [previewCount, setPreviewCount] = useState<number | null>(initialResultCount ?? null);
  const resultCount = previewCount ?? initialResultCount;
  const activeCountEndpoint =
    countEndpoint ??
    (title.includes("sản phẩm") || title.includes("thiết lập giá")
      ? "/api/inventory/products/count"
      : undefined);
  const range =
    draft.time === "custom"
      ? { from: draft.from, to: draft.to }
      : resolveOrderTimePreset(draft.time as never) ?? { from: "", to: "" };
  const customDateError =
    draft.time === "custom" && !isOrderDateRangeValid(draft.from, draft.to)
      ? "Khoảng ngày không hợp lệ hoặc vượt quá 1 năm."
      : "";
  const active = Object.entries(draft).filter(([key, value]) =>
    key !== "view" &&
    key !== "from" &&
    key !== "to" &&
    Boolean(value) &&
    !(key === "time" && value === "all"),
  ).length;

  const close = useCallback(() => {
    setDraft(initial);
    setEntityLabels({});
    setOpen(false);
  }, [initial, setDraft, setEntityLabels, setOpen]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const focusElements = () => collectFocusableElements(panel);
    window.requestAnimationFrame(() => focusElements()[0]?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? index <= 0 ? focusable.length - 1 : index - 1
        : index === -1 || index === focusable.length - 1 ? 0 : index + 1;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || !activeCountEndpoint || customDateError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams(
        activeCountEndpoint.includes("products")
          ? {
              q: params.get("q") ?? "",
              categoryId: draft.category,
              brandId: draft.brand,
              supplierId: draft.supplier,
              productKind: draft.kind,
              status: draft.status || "active",
              stock: draft.stock,
              sort: draft.sort,
              view: draft.view,
            }
          : isInternalUseFilter
            ? {
              q: params.get("q") ?? "",
              status: draft.status,
              warehouseId: draft.warehouse,
              reason: draft.reason,
              department: draft.department,
              from: range.from,
              to: range.to,
            }
            : {
              q: params.get("q") ?? "",
              status: draft.status,
              supplierId: draft.supplier,
              warehouseId: draft.warehouse,
              from: range.from,
              to: range.to,
              debtOnly: draft.debt,
            },
      );
      try {
        const response = await fetch(`${activeCountEndpoint}?${query.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { total?: unknown };
        };
        if (!response.ok || !payload.ok || typeof payload.data?.total !== "number") {
          throw new Error("count_failed");
        }
        setPreviewCount(payload.data.total);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPreviewCount(null);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeCountEndpoint, customDateError, draft, isInternalUseFilter, open, params, range.from, range.to]);

  function update(field: Field, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function optionLabel(field: Field, options: Option[]) {
    const value = draft[field];
    return entityLabels[field] ?? options.find((option) => option.value === value)?.label ?? "";
  }

  function asyncPicker(
    field: "category" | "brand" | "supplier" | "warehouse",
    label: string,
    options: Option[],
    kind: EntityPickerKind,
  ) {
    return (
      <LumaEntityPicker
        label={label}
        name={field === "supplier" ? "supplierId" : field === "warehouse" ? "warehouseId" : field === "brand" ? "brandId" : "category"}
        labelName={`${field}Label`}
        kind={kind}
        endpoint="/api/inventory/filter-options"
        value={draft[field]}
        labelValue={optionLabel(field, options)}
        placeholder={`Tìm ${label.toLocaleLowerCase("vi")}`}
        showLabel={isPurchaseFilter}
        onChange={(next) => {
          update(field, next.value);
          setEntityLabels((current) => ({ ...current, [field]: next.label }));
        }}
      />
    );
  }

  function picker(field: Field, label: string, options: Option[]) {
    return (
      <LumaWebPicker
        ariaLabel={label}
        name={field}
        value={draft[field]}
        options={options}
        searchable={options.length > 8}
        searchPlaceholder={`Tìm ${label.toLocaleLowerCase("vi")}`}
        onChange={(value) => update(field, value)}
      />
    );
  }

  function reset() {
    setDraft({
      category: "",
      status: "",
      view: "grouped",
      warehouse: "",
      supplier: "",
      stock: "",
      time: "all",
      from: "",
      to: "",
      debt: "",
      reason: "",
      department: "",
      brand: "",
      kind: "",
      sort: "",
    });
    setEntityLabels({});
  }

  function apply() {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    for (const key of [
      "category",
      "status",
      "view",
      "warehouse",
      "warehouseId",
      "supplierId",
      "stock",
      "timePreset",
      "from",
      "to",
      "debtOnly",
      "reason",
      "department",
      "brandId",
      "productKind",
      "sort",
    ]) next.delete(key);
    const map: Record<string, string> = {
      category: draft.category,
      status: draft.status,
      view: draft.view,
      [isPurchaseFilter ? "warehouseId" : "warehouse"]: draft.warehouse,
      supplierId: draft.supplier,
      stock: draft.stock,
      timePreset: draft.time,
      from: range.from,
      to: range.to,
      debtOnly: draft.debt,
      reason: draft.reason,
      department: draft.department,
      brandId: draft.brand,
      productKind: draft.kind,
      sort: draft.sort,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value && !(key === "view" && value === "grouped") && !(key === "timePreset" && value === "all")) {
        next.set(key, value);
      }
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    setOpen(false);
  }

  const statusPicker = picker(
    "status",
    "Trạng thái phiếu",
    isPurchaseFilter
      ? purchaseStatuses
      : isInternalUseFilter
        ? internalUseStatuses
        : productStatuses,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setDraft(initial);
          setEntityLabels({});
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold"
      >
        <SlidersHorizontal className="h-4 w-4 text-primary-600" />
        Bộ lọc
        {active > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs text-white" aria-label={`${active} điều kiện lọc`}>
            {active}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30" role="presentation" onMouseDown={close}>
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-filter-title"
            className="ml-auto flex h-full w-full max-w-[460px] flex-col bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b border-border px-6 py-5">
              <div>
                <h2 id="inventory-filter-title" className="text-xl font-bold">{title}</h2>
                <p className="mt-1 text-sm text-slate-500">{active} điều kiện đang chọn</p>
              </div>
              <button type="button" aria-label="Đóng bộ lọc" onClick={close} className="rounded-lg p-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {isPurchaseFilter && (
                <section>
                  <h3 className="mb-3 font-bold">Tìm theo</h3>
                  <div className="space-y-3">
                    {fields.includes("supplier") && asyncPicker("supplier", "Nhà cung cấp", suppliers, "supplier")}
                    {fields.includes("warehouse") && asyncPicker("warehouse", "Kho nhận", warehouses, "warehouse")}
                  </div>
                </section>
              )}

              {!isPurchaseFilter && fields.includes("kind") && <section><h3 className="mb-3 font-bold">Loại hàng</h3>{picker("kind", "Loại hàng", [all, { value: "product", label: "Sản phẩm" }, { value: "service", label: "Dịch vụ" }, { value: "combo", label: "Combo" }])}</section>}
              {!isPurchaseFilter && !isInternalUseFilter && fields.includes("status") && <section><h3 className="mb-3 font-bold">Trạng thái kinh doanh</h3>{statusPicker}</section>}
              {fields.includes("sort") && <section><h3 className="mb-3 font-bold">Sắp xếp</h3>{picker("sort", "Sắp xếp", [all, { value: "name", label: "Tên sản phẩm" }, { value: "stock", label: "Tồn kho" }, { value: "updated", label: "Cập nhật gần nhất" }])}</section>}
              {fields.includes("view") && <section><h3 className="mb-3 font-bold">Hiển thị</h3>{picker("view", "Hiển thị", [{ value: "grouped", label: "Nhóm sản phẩm" }, { value: "flat", label: "Danh sách phẳng" }])}</section>}
              {fields.includes("stock") && <section><h3 className="mb-3 font-bold">Tình trạng tồn</h3>{picker("stock", "Tình trạng tồn", stockOptions)}</section>}
              {!isPurchaseFilter && fields.includes("category") && <section><h3 className="mb-3 font-bold">Danh mục</h3>{asyncPicker("category", "Danh mục", categories, "category")}</section>}
              {!isPurchaseFilter && fields.includes("brand") && <section><h3 className="mb-3 font-bold">Thương hiệu</h3>{asyncPicker("brand", "Thương hiệu", brands, "brand")}</section>}
              {!isPurchaseFilter && fields.includes("supplier") && <section><h3 className="mb-3 font-bold">Nhà cung cấp</h3>{asyncPicker("supplier", "Nhà cung cấp", suppliers, "supplier")}</section>}
              {!isPurchaseFilter && fields.includes("warehouse") && <section><h3 className="mb-3 font-bold">Kho</h3>{asyncPicker("warehouse", "Kho", warehouses, "warehouse")}</section>}
              {fields.includes("reason") && <section><h3 className="mb-3 font-bold">Loại xuất</h3>{picker("reason", "Loại xuất", [all, ...reasons])}</section>}
              {fields.includes("department") && <section><h3 className="mb-3 font-bold">Người nhận / bộ phận</h3>{picker("department", "Người nhận / bộ phận", [all, ...departments])}</section>}

              {fields.includes("time") && (
                <section>
                  <h3 className="mb-3 font-bold">Thời gian</h3>
                  {picker("time", "Khoảng thời gian", ORDER_TIME_PRESETS.map((option) => ({ value: option.value, label: option.label })))}
                  {draft.time === "custom" ? (
                    <div className="mt-3">
                      <LumaDateRangePicker
                        fromName="from"
                        toName="to"
                        from={draft.from}
                        to={draft.to}
                        error={customDateError}
                        onChange={(from, to) => setDraft((current) => ({ ...current, from, to }))}
                      />
                    </div>
                  ) : range.from ? (
                    <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><CalendarDays className="size-4 text-primary-600" />{range.from} – {range.to}</p>
                  ) : null}
                </section>
              )}

              {(isPurchaseFilter || isInternalUseFilter) && fields.includes("status") && <section><h3 className="mb-3 font-bold">Trạng thái phiếu</h3>{statusPicker}</section>}
              {fields.includes("debt") && (
                <div className="flex items-center justify-between rounded-xl border border-border p-3">
                  <span><span className="block font-semibold">Chỉ phiếu còn nợ</span><span className="text-xs text-slate-500">Bật để xem các phiếu nhập còn nợ</span></span>
                  <Toggle aria-label="Chỉ phiếu còn nợ" checked={draft.debt === "1"} onChange={(checked) => update("debt", checked ? "1" : "")} />
                </div>
              )}
            </div>

            <footer className="flex gap-3 border-t border-border px-6 py-4">
              <button type="button" onClick={reset} className="min-h-11 flex-1 rounded-lg border border-primary-600 font-bold text-primary-700">Xóa lọc</button>
              <button type="button" disabled={Boolean(customDateError)} onClick={apply} className="min-h-11 flex-1 rounded-lg bg-primary-600 font-bold text-white disabled:opacity-50">
                Xem {resultCount == null ? "danh sách" : `${resultCount.toLocaleString("vi-VN")} ${resultLabel}`}
              </button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
