"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  CalendarDays,
  Check,
  FileText,
  Info,
  Link2,
  Package,
  PackageCheck,
  Plus,
  Search,
  Trash2,
  Warehouse,
} from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { SearchableSelect } from "@/components/combobox";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { Field } from "@/components/ui/label";
import { saveServiceInstallationBatch } from "@/lib/actions/services";
import { inferServiceItemTracking } from "@/lib/services/installation-item-classification";
import { normalizeSearch } from "@/lib/normalize";
import type { ProductCatalogItem } from "@/lib/product-catalog";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type Tracking = "consumable" | "asset";
type StockMode = "plan" | "reserve" | "issue";
type InvoiceMode = "none" | "link" | "create";

type InstallationDraft = {
  clientDraftId: string;
  product: ProductCatalogItem;
  tracking: Tracking;
  quantity: number;
  unitName: string;
  serialText: string;
};

type ProjectJob = { id: string; code: string; title: string };
type ProjectOrder = { id: string; code: string; status: string };
type WarehouseOption = { id: string; name: string; isDefault: boolean };

export function ServiceInstallationBatchCreate({
  project,
  jobs,
  orders,
  warehouses,
}: {
  project: { id: string; name: string; customerId: string | null };
  jobs: ProjectJob[];
  orders: ProjectOrder[];
  warehouses: WarehouseOption[];
}) {
  const router = useRouter();
  const { products, status, refresh } = useProductCatalog();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<InstallationDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [stockMode, setStockMode] = useState<StockMode>("plan");
  const [warehouseId, setWarehouseId] = useState(
    warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? "",
  );
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>("none");
  const [materialOrderId, setMaterialOrderId] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef<string | null>(null);
  const installedAtRef = useRef<string | null>(null);

  const selectedIds = useMemo(() => new Set(drafts.map((draft) => draft.product.id)), [drafts]);
  const visibleProducts = useMemo(() => {
    const normalized = normalizeSearch(query);
    return products.filter((product) => {
      if (product.productKind !== "product" || product.isVariantParent) return false;
      if (!normalized) return true;
      return normalizeSearch([
        product.name,
        product.sku,
        product.barcode ?? "",
        product.model ?? "",
        product.brandName ?? "",
        product.categoryName ?? "",
      ].join(" ")).includes(normalized);
    }).slice(0, 80);
  }, [products, query]);
  const activeDraft = drafts.find((draft) => draft.clientDraftId === activeDraftId) ?? drafts[0] ?? null;
  const linkedOrders = orders.filter((order) => order.status !== "quote" && order.status !== "cancelled");
  const effectiveStockMode = invoiceMode === "none" ? stockMode : "plan";
  const canSubmit = Boolean(
    jobId
    && drafts.length > 0
    && !busy
    && (effectiveStockMode === "plan" || warehouseId)
    && (invoiceMode !== "link" || materialOrderId),
  );

  function reset() {
    requestIdRef.current = null;
    installedAtRef.current = null;
    setQuery("");
    setDrafts([]);
    setActiveDraftId(null);
    setStockMode("plan");
    setInvoiceMode("none");
    setMaterialOrderId("");
    setLocationLabel("");
    setNote("");
    setError("");
  }

  function addProduct(product: ProductCatalogItem) {
    const existing = drafts.find((draft) => draft.product.id === product.id);
    if (existing) {
      setActiveDraftId(existing.clientDraftId);
      return;
    }
    const tracking = inferServiceItemTracking(product);
    const draft: InstallationDraft = {
      clientDraftId: `install-${crypto.randomUUID()}`,
      product,
      tracking,
      quantity: 1,
      unitName: product.baseUnit,
      serialText: "",
    };
    setDrafts((current) => [...current, draft]);
    setActiveDraftId(draft.clientDraftId);
  }

  function updateDraft(clientDraftId: string, patch: Partial<InstallationDraft>) {
    setDrafts((current) => current.map((draft) => (
      draft.clientDraftId === clientDraftId ? { ...draft, ...patch } : draft
    )));
  }

  function removeDraft(clientDraftId: string) {
    setDrafts((current) => current.filter((draft) => draft.clientDraftId !== clientDraftId));
    if (activeDraftId === clientDraftId) setActiveDraftId(null);
  }

  function chooseInvoiceMode(next: InvoiceMode) {
    setInvoiceMode(next);
    if (next !== "link") setMaterialOrderId("");
    if (next !== "none") setStockMode("plan");
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    requestIdRef.current ??= `installation-${project.id}-${crypto.randomUUID()}`;
    installedAtRef.current ??= new Date().toISOString();
    const result = await saveServiceInstallationBatch({
      projectId: project.id,
      jobId,
      requestId: requestIdRef.current,
      stockMode: effectiveStockMode,
      warehouseId: effectiveStockMode === "plan" ? null : warehouseId,
      invoiceMode,
      materialOrderId: invoiceMode === "link" ? materialOrderId : null,
      locationLabel: locationLabel || undefined,
      installedAt: installedAtRef.current,
      note: note || undefined,
      items: drafts.map((draft) => ({
        clientDraftId: draft.clientDraftId,
        productId: draft.product.id,
        unitName: draft.unitName,
        quantity: draft.quantity,
        tracking: draft.tracking,
        serialNumbers: draft.tracking === "asset"
          ? draft.serialText.split("\n").map((serial) => serial.trim()).filter(Boolean)
          : [],
        assetKind: draft.product.categoryName || "device",
        name: draft.product.name,
        model: draft.product.model || undefined,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      setError(errorLabel(result.error));
      return;
    }
    setOpen(false);
    if (invoiceMode === "create") {
      router.push(Routes.projectInvoice({
        projectId: project.id,
        projectName: project.name,
        customerId: project.customerId,
        items: drafts.map((draft) => ({
          productId: draft.product.id,
          unitName: draft.unitName,
          quantity: draft.quantity,
        })),
      }));
      reset();
      return;
    }
    reset();
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={jobs.length === 0}>
        <Plus className="h-4 w-4" />
        Thêm vật tư & thiết bị
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (busy) return;
          setOpen(false);
          reset();
        }}
        title="Thêm vật tư & thiết bị"
        subtitle={(
          <SearchableSelect
            value={jobId}
            onChange={setJobId}
            allowClear={false}
            showSearch
            placeholder="Chọn lệnh việc"
            className="mt-2 w-full max-w-xl"
            options={jobs.map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` }))}
          />
        )}
        size="full"
        panelClassName="sm:max-w-7xl"
        bodyClassName="p-0 sm:p-0"
        footer={(
          <div className="flex items-center justify-between gap-3">
            <p className="hidden text-xs text-slate-500 sm:block">
              {drafts.length} dòng · {drafts.filter((draft) => draft.tracking === "asset").length} sản phẩm theo dõi
            </p>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Hủy</Button>
              <Button type="button" onClick={submit} loading={busy} disabled={!canSubmit}>
                Lưu vật tư & thiết bị
              </Button>
            </div>
          </div>
        )}
      >
        <div className="grid min-h-full lg:grid-cols-[minmax(320px,.78fr)_minmax(0,1.22fr)]">
          <section className="border-b border-border-soft p-4 lg:border-b-0 lg:border-r lg:p-5" aria-labelledby="installation-catalog-title">
            <h3 id="installation-catalog-title" className="text-sm font-bold">1. Tìm & chọn sản phẩm</h3>
            <div className="relative mt-4">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm sản phẩm theo tên, SKU hoặc model"
                leftIcon={<Search />}
              />
            </div>
            <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-border" role="listbox" aria-multiselectable="true">
              {status === "loading" && products.length === 0 ? (
                <CatalogMessage text="Đang tải danh mục sản phẩm…" />
              ) : status === "unavailable" && products.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  <p>Không thể tải danh mục sản phẩm.</p>
                  <Button type="button" variant="link" size="sm" onClick={() => void refresh()}>Thử lại</Button>
                </div>
              ) : visibleProducts.length === 0 ? (
                <CatalogMessage text="Không tìm thấy sản phẩm phù hợp." />
              ) : visibleProducts.map((product) => {
                const selected = selectedIds.has(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => addProduct(product)}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-3 border-b border-border-soft px-3 py-2 text-left last:border-b-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
                      selected && "bg-primary-50 dark:bg-primary-950/40",
                    )}
                  >
                    <ProductThumb product={product} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{product.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">SKU: {product.sku}</span>
                    </span>
                    <span className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                      selected ? "border-primary-600 bg-primary-600 text-white" : "border-border text-primary-700",
                    )}>
                      {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Loại vật tư hay thiết bị được đề xuất tự động và có thể đổi ở phần chi tiết.
            </p>
          </section>

          <div className="min-w-0">
            <section className="border-b border-border-soft p-4 lg:p-5" aria-labelledby="installation-selected-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="installation-selected-title" className="text-sm font-bold">2. Danh sách đã chọn</h3>
                {drafts.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setDrafts([]); setActiveDraftId(null); }}>
                    <Trash2 className="h-4 w-4" />Xóa tất cả
                  </Button>
                )}
              </div>
              {drafts.length === 0 ? (
                <div className="mt-4 grid min-h-36 place-items-center rounded-xl border border-dashed border-border p-6 text-center">
                  <div><PackageCheck className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-semibold">Chưa chọn sản phẩm</p><p className="mt-1 text-xs text-slate-500">Chọn từ danh mục để thêm cùng lúc vật tư và thiết bị.</p></div>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {drafts.map((draft) => (
                    <div
                      key={draft.clientDraftId}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveDraftId(draft.clientDraftId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveDraftId(draft.clientDraftId);
                        }
                      }}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_40px] items-center gap-3 rounded-xl border px-3 py-3 text-left sm:grid-cols-[minmax(0,1fr)_132px_150px_auto]",
                        activeDraft?.clientDraftId === draft.clientDraftId
                          ? "border-primary-300 bg-primary-50/50 dark:border-primary-700 dark:bg-primary-950/30"
                          : "border-border-soft hover:bg-surface-2",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ProductThumb product={draft.product} compact />
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{draft.product.name}</span><span className="block truncate text-xs text-slate-500">{draft.product.sku}</span></span>
                      </span>
                      <span className="hidden sm:block" onClick={(event) => event.stopPropagation()}>
                        <QuantityInput
                          value={draft.quantity}
                          onChange={(quantity) => updateDraft(draft.clientDraftId, { quantity })}
                          min={draft.tracking === "asset" ? 1 : 0.0001}
                          step={draft.tracking === "asset" ? 1 : 0.1}
                          decimals={draft.tracking === "asset" ? 0 : 4}
                          inputLabel={`Số lượng ${draft.product.name}`}
                        />
                      </span>
                      <span className={cn(
                        "hidden rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold sm:block",
                        draft.tracking === "asset" ? "bg-primary-50 text-primary-800" : "bg-amber-50 text-amber-700",
                      )}>{draft.tracking === "asset" ? "Thiết bị theo dõi" : "Vật tư tiêu hao"}</span>
                      <span className="contents sm:flex sm:items-center sm:justify-end sm:gap-2">
                        <span className="col-span-2 row-start-2 text-right text-xs font-semibold [overflow-wrap:anywhere] sm:hidden">{draft.quantity} {draft.unitName}</span>
                        <button
                          type="button"
                          aria-label={`Xóa ${draft.product.name}`}
                          onClick={(event) => { event.stopPropagation(); removeDraft(draft.clientDraftId); }}
                          className="col-start-2 row-start-1 grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 sm:col-auto sm:row-auto"
                        ><Trash2 className="h-4 w-4" /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {activeDraft && (
              <section className="border-b border-border-soft p-4 lg:p-5" data-installation-detail="true">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">3. Chi tiết dòng đang chọn</h3>
                  <span className="truncate text-xs font-semibold text-primary-700">{activeDraft.product.name}</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Số lượng">
                    <QuantityInput
                      value={activeDraft.quantity}
                      onChange={(quantity) => updateDraft(activeDraft.clientDraftId, { quantity })}
                      min={activeDraft.tracking === "asset" ? 1 : 0.0001}
                      step={activeDraft.tracking === "asset" ? 1 : 0.1}
                      decimals={activeDraft.tracking === "asset" ? 0 : 4}
                      inputLabel={`Số lượng ${activeDraft.product.name}`}
                    />
                  </Field>
                  <Field label="Phân loại">
                    <SearchableSelect
                      value={activeDraft.tracking}
                      allowClear={false}
                      onChange={(tracking) => updateDraft(activeDraft.clientDraftId, {
                        tracking: tracking as Tracking,
                        quantity: tracking === "asset" ? Math.max(1, Math.round(activeDraft.quantity)) : activeDraft.quantity,
                        serialText: tracking === "asset" ? activeDraft.serialText : "",
                      })}
                      options={[
                        { value: "asset", label: "Thiết bị theo dõi", hint: "Có thể khai báo serial" },
                        { value: "consumable", label: "Vật tư tiêu hao", hint: "Theo dõi theo số lượng" },
                      ]}
                    />
                  </Field>
                  <Field label="Đơn vị">
                    <SearchableSelect
                      value={activeDraft.unitName}
                      allowClear={false}
                      onChange={(unitName) => updateDraft(activeDraft.clientDraftId, { unitName })}
                      options={[
                        { value: activeDraft.product.baseUnit, label: activeDraft.product.baseUnit },
                        ...activeDraft.product.units
                          .filter((unit) => unit.unitName !== activeDraft.product.baseUnit)
                          .map((unit) => ({ value: unit.unitName, label: unit.unitName })),
                      ]}
                    />
                  </Field>
                  <Field label="Vị trí lắp đặt">
                    <Input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} placeholder="Ví dụ: Tầng 1 · Cửa chính" />
                  </Field>
                  {activeDraft.tracking === "asset" && (
                    <Field label={`Serial (${activeDraft.serialText.split("\n").filter((value) => value.trim()).length}/${Math.trunc(activeDraft.quantity)})`} className="sm:col-span-2">
                      <Textarea
                        value={activeDraft.serialText}
                        onChange={(event) => updateDraft(activeDraft.clientDraftId, { serialText: event.target.value })}
                        rows={Math.min(5, Math.max(2, Math.trunc(activeDraft.quantity)))}
                        placeholder="Mỗi serial một dòng; có thể bổ sung sau"
                      />
                    </Field>
                  )}
                </div>
              </section>
            )}

            <section className="border-b border-border-soft p-4 lg:p-5" aria-labelledby="installation-stock-title">
              <h3 id="installation-stock-title" className="flex items-center gap-2 text-sm font-bold">4. Xử lý kho <Info className="h-4 w-4 text-slate-400" /></h3>
              {invoiceMode !== "none" && (
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">Kho sẽ được xử lý bởi hóa đơn để tránh trừ tồn hai lần.</p>
              )}
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <ModeCard icon={CalendarDays} title="Chỉ lập kế hoạch" description="Không giữ hàng, không xuất kho" selected={effectiveStockMode === "plan"} onClick={() => setStockMode("plan")} disabled={invoiceMode !== "none"} />
                <ModeCard icon={Box} title="Giữ hàng" description="Giữ tồn cho công trình" selected={effectiveStockMode === "reserve"} onClick={() => setStockMode("reserve")} disabled={invoiceMode !== "none"} />
                <ModeCard icon={Warehouse} title="Xuất theo đã dùng" description="Trừ kho khi bấm Lưu" selected={effectiveStockMode === "issue"} onClick={() => setStockMode("issue")} disabled={invoiceMode !== "none"} />
              </div>
              {effectiveStockMode !== "plan" && (
                <div className="mt-3 max-w-sm">
                  <Field label="Kho xuất">
                    <SearchableSelect
                      value={warehouseId}
                      allowClear={false}
                      onChange={setWarehouseId}
                      placeholder="Chọn kho"
                      options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name, hint: warehouse.isDefault ? "Mặc định" : undefined }))}
                    />
                  </Field>
                </div>
              )}
            </section>

            <section className="p-4 lg:p-5" aria-labelledby="installation-invoice-title">
              <h3 id="installation-invoice-title" className="flex items-center gap-2 text-sm font-bold">5. Hóa đơn <Info className="h-4 w-4 text-slate-400" /></h3>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <ModeCard icon={FileText} title="Chưa lập" description="Lưu vào công trình trước" selected={invoiceMode === "none"} onClick={() => chooseInvoiceMode("none")} />
                <ModeCard icon={Link2} title="Liên kết hóa đơn" description="Gắn với hóa đơn hiện có" selected={invoiceMode === "link"} onClick={() => chooseInvoiceMode("link")} />
                <ModeCard icon={Plus} title="Tạo hóa đơn" description="Mở nháp hóa đơn sau khi lưu" selected={invoiceMode === "create"} onClick={() => chooseInvoiceMode("create")} />
              </div>
              {invoiceMode === "link" && (
                <div className="mt-3 max-w-md">
                  <Field label="Hóa đơn liên kết">
                    <SearchableSelect
                      value={materialOrderId}
                      onChange={setMaterialOrderId}
                      allowClear={false}
                      showSearch
                      placeholder="Chọn hóa đơn"
                      options={linkedOrders.map((order) => ({ value: order.id, label: order.code }))}
                    />
                  </Field>
                </div>
              )}
              <div className="mt-3 max-w-xl">
                <Field label="Ghi chú">
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Ghi chú chung cho lần lắp đặt" />
                </Field>
              </div>
              {error && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{error}</p>}
            </section>
          </div>
        </div>
      </RowPreviewModal>
    </>
  );
}

function ProductThumb({ product, compact = false }: { product: ProductCatalogItem; compact?: boolean }) {
  const imageUrl = product.imageUrls?.[0];
  const size = compact ? "h-10 w-10" : "h-12 w-12";
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border-soft bg-surface-2", size)}>
      {imageUrl ? (
        <Image src={imageUrl} alt="" width={48} height={48} unoptimized className="h-full w-full object-cover" />
      ) : <Package className="h-5 w-5 text-slate-300" />}
    </span>
  );
}

function CatalogMessage({ text }: { text: string }) {
  return <p className="p-6 text-center text-sm text-slate-500">{text}</p>;
}

function ModeCard({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
  disabled = false,
}: {
  icon: typeof Box;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex min-h-20 items-start gap-3 rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55",
        selected ? "border-primary-600 bg-primary-50 text-primary-900" : "border-border hover:bg-surface-2",
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" />
      <span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
    </button>
  );
}

function errorLabel(error: string) {
  const labels: Record<string, string> = {
    "services.errors.projectRequired": "Công trình hoặc lệnh việc không hợp lệ.",
    "services.errors.relationMismatch": "Lệnh việc hoặc hóa đơn không thuộc công trình này.",
    "services.errors.invalidMaterialUnit": "Đơn vị của một sản phẩm chưa được cấu hình đúng.",
    "services.errors.materialWarehouseMismatch": "Vật tư đã được xử lý ở một kho khác.",
    "services.errors.reservationExceedsPlan": "Số lượng giữ vượt quá kế hoạch vật tư.",
    "services.errors.insufficientMaterialStock": "Kho không đủ số lượng để hoàn tất thao tác.",
    "services.errors.duplicateSerial": "Serial đã tồn tại trong hệ thống.",
    "errors.forbidden": "Bạn không có quyền thực hiện thao tác này.",
    "errors.notFound": "Không tìm thấy sản phẩm đã chọn.",
  };
  return labels[error] ?? "Không thể lưu vật tư và thiết bị. Vui lòng thử lại.";
}
