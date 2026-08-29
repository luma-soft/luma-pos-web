"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FolderSearch,
  Info,
  LoaderCircle,
  PackageSearch,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RowPreviewModal } from "@/components/data-table";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { SearchableSelect } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { QuantityInput } from "@/components/ui/quantity-input";
import { createInstalledAssetsBatch } from "@/lib/actions/services";
import { normalizeSearch } from "@/lib/normalize";
import type { ProductCatalogItem } from "@/lib/product-catalog";
import { serviceEvidencePhotoCapacity } from "@/lib/services/evidence-storage";
import {
  INSTALLED_ASSET_BATCH_LIMIT,
  resizeInstalledAssetProductDrafts,
} from "@/lib/services/installed-asset-quantity";
import {
  installedAssetCatalogFeedback,
  validateInstalledAssetBatchDrafts,
} from "@/lib/services/schemas";
import { cn } from "@/lib/utils";

type AssetSource = "catalog" | "manual";

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  uploaded: boolean;
};

type AssetDraft = {
  clientDraftId: string;
  productId: string | null;
  sku: string | null;
  catalogImageUrl: string | null;
  name: string;
  assetKind: string;
  brand: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  ipAddress: string;
  photos: PendingPhoto[];
  edited: boolean;
};

export function InstalledAssetBatchCreate({
  projectId,
  serviceType,
  jobs,
}: {
  projectId: string;
  serviceType?: string | null;
  jobs: { id: string; code: string; title: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const { products, status: catalogStatus, refresh: refreshCatalog } = useProductCatalog();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<AssetSource>("catalog");
  const [catalogDrafts, setCatalogDrafts] = useState<AssetDraft[]>([]);
  const [manualDraft, setManualDraft] = useState<AssetDraft>(() => makeManualDraft(serviceType));
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [commonExpanded, setCommonExpanded] = useState(true);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [installedOn, setInstalledOn] = useState(todayDate());
  const [warrantyEndsOn, setWarrantyEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(() => newRequestId(projectId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const drafts = source === "catalog" ? catalogDrafts : [manualDraft];
  const selectedIds = useMemo(
    () => new Set(catalogDrafts.flatMap((draft) => draft.productId ? [draft.productId] : [])),
    [catalogDrafts],
  );
  const selectedProductCount = selectedIds.size;
  const visibleProducts = useMemo(() => {
    const normalized = normalizeSearch(query);
    return products.filter((product) => {
      if (product.productKind !== "product" || product.isVariantParent) return false;
      if (!normalized) return true;
      return normalizeSearch([
        product.name,
        product.sku,
        product.barcode ?? "",
        product.brandName ?? "",
        product.categoryName ?? "",
        product.model ?? "",
      ].join(" ")).includes(normalized);
    }).slice(0, 40);
  }, [products, query]);
  const catalogFeedback = installedAssetCatalogFeedback(catalogStatus, products.length);

  const canSubmit = drafts.length > 0;

  useEffect(() => {
    if (!open || !pickerOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open, pickerOpen]);

  function chooseSource(next: AssetSource) {
    if (busy) return;
    setSource(next);
    setExpandedDraftId(next === "catalog" ? catalogDrafts[0]?.clientDraftId ?? null : manualDraft.clientDraftId);
  }

  async function toggleProduct(product: ProductCatalogItem) {
    if (busy) return;
    setSource("catalog");
    const existing = catalogDrafts.filter((draft) => draft.productId === product.id);
    if (existing.length > 0) {
      if (existing.some(hasDraftUserData)) {
        const confirmed = await dialog.confirm({
          title: "Bỏ sản phẩm đã nhập thông tin?",
          description: `Thao tác này sẽ xóa ${existing.length} hồ sơ thiết bị cùng serial, ảnh và thông tin đã nhập.`,
          confirmLabel: "Bỏ sản phẩm",
          cancelLabel: "Giữ lại",
          variant: "destructive",
        });
        if (!confirmed) return;
      }
      existing.forEach(releaseDraftPhotos);
      const next = catalogDrafts.filter((draft) => draft.productId !== product.id);
      setCatalogDrafts(next);
      if (existing.some((draft) => draft.clientDraftId === expandedDraftId)) {
        setExpandedDraftId(next[0]?.clientDraftId ?? null);
      }
      return;
    }
    if (catalogDrafts.length >= INSTALLED_ASSET_BATCH_LIMIT) {
      setError(`Mỗi lần chỉ có thể tạo tối đa ${INSTALLED_ASSET_BATCH_LIMIT} thiết bị.`);
      return;
    }
    const draft = makeCatalogDraft(product, serviceType);
    setCatalogDrafts((current) => [...current, draft]);
    setExpandedDraftId((value) => value ?? draft.clientDraftId);
  }

  async function updateProductQuantity(product: ProductCatalogItem, quantity: number) {
    if (busy) return;
    const resized = resizeInstalledAssetProductDrafts({
      drafts: catalogDrafts,
      productId: product.id,
      quantity,
      createDraft: () => makeCatalogDraft(product, serviceType),
    });
    if (resized.removed.some(hasDraftUserData)) {
      const confirmed = await dialog.confirm({
        title: "Giảm số lượng thiết bị?",
        description: `Thao tác này sẽ xóa ${resized.removed.length} hồ sơ thiết bị cùng serial, ảnh và thông tin đã nhập.`,
        confirmLabel: "Giảm số lượng",
        cancelLabel: "Giữ lại",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    resized.removed.forEach(releaseDraftPhotos);
    setCatalogDrafts(resized.drafts);
    if (resized.removed.some((draft) => draft.clientDraftId === expandedDraftId)) {
      setExpandedDraftId(
        resized.drafts.find((draft) => draft.productId === product.id)?.clientDraftId
          ?? resized.drafts[0]?.clientDraftId
          ?? null,
      );
    }
  }

  function updateDraft(clientDraftId: string, patch: Partial<AssetDraft>) {
    if (source === "manual") {
      setManualDraft((draft) => draft.clientDraftId === clientDraftId ? { ...draft, ...patch } : draft);
      return;
    }
    setCatalogDrafts((current) => current.map((draft) => (
      draft.clientDraftId === clientDraftId ? { ...draft, ...patch, edited: true } : draft
    )));
  }

  async function removeDraft(clientDraftId: string) {
    const removed = catalogDrafts.find((draft) => draft.clientDraftId === clientDraftId);
    if (!removed) return;
    if (hasDraftUserData(removed)) {
      const confirmed = await dialog.confirm({
        title: "Xóa thiết bị đã nhập thông tin?",
        description: "Serial, ảnh và thông tin đã nhập cho thiết bị này sẽ bị xóa.",
        confirmLabel: "Xóa thiết bị",
        cancelLabel: "Giữ lại",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    releaseDraftPhotos(removed);
    const next = catalogDrafts.filter((draft) => draft.clientDraftId !== clientDraftId);
    setCatalogDrafts(next);
    if (expandedDraftId === clientDraftId) {
      setExpandedDraftId(next[0]?.clientDraftId ?? null);
    }
  }

  function addPhotos(clientDraftId: string, files: FileList | null) {
    if (!files?.length) return;
    const draft = drafts.find((item) => item.clientDraftId === clientDraftId);
    if (!draft) return;
    const selected = Array.from(files);
    const valid = selected.filter((file) => isAcceptedAssetPhoto(file));
    const capacity = serviceEvidencePhotoCapacity(draft.photos.length, valid.length);
    const accepted = valid.slice(0, capacity.acceptedCount);
    const errors = [
      ...(valid.length !== selected.length
        ? ["Chỉ nhận JPG, PNG, WebP, HEIC/HEIF và tối đa 15 MB mỗi ảnh."]
        : []),
      ...(capacity.message ? [capacity.message] : []),
    ];
    setError(errors.join(" "));
    const photos = accepted.map((file) => ({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      uploaded: false,
    }));
    updateDraft(clientDraftId, { photos: [...draft.photos, ...photos] });
  }

  function removePhoto(clientDraftId: string, photoId: string) {
    const draft = drafts.find((item) => item.clientDraftId === clientDraftId);
    const photo = draft?.photos.find((item) => item.id === photoId);
    if (!draft || !photo || photo.uploaded) return;
    URL.revokeObjectURL(photo.previewUrl);
    updateDraft(clientDraftId, { photos: draft.photos.filter((item) => item.id !== photoId) });
  }

  function makePrimaryPhoto(clientDraftId: string, photoId: string) {
    const draft = drafts.find((item) => item.clientDraftId === clientDraftId);
    const photo = draft?.photos.find((item) => item.id === photoId);
    if (
      !draft
      || !photo
      || draft.photos[0]?.id === photoId
      || draft.photos.some((photo) => photo.uploaded)
    ) return;
    updateDraft(clientDraftId, {
      photos: [photo, ...draft.photos.filter((item) => item.id !== photoId)],
    });
  }

  function movePhoto(clientDraftId: string, fromPhotoId: string, toPhotoId: string) {
    const draft = drafts.find((item) => item.clientDraftId === clientDraftId);
    if (
      !draft
      || fromPhotoId === toPhotoId
      || draft.photos.some((photo) => photo.uploaded)
    ) return;
    const fromIndex = draft.photos.findIndex((item) => item.id === fromPhotoId);
    const toIndex = draft.photos.findIndex((item) => item.id === toPhotoId);
    if (fromIndex < 0 || toIndex < 0) return;
    const photos = [...draft.photos];
    const [photo] = photos.splice(fromIndex, 1);
    photos.splice(toIndex, 0, photo);
    updateDraft(clientDraftId, { photos });
  }

  async function submit() {
    if (!canSubmit || busy) return;
    const validation = validateInstalledAssetBatchDrafts({
      locationLabel,
      installedOn,
      assets: drafts.map((draft) => ({
        clientDraftId: draft.clientDraftId,
        name: draft.name,
        assetKind: draft.assetKind,
      })),
    });
    if (!validation.valid) {
      const firstAssetIssue = validation.issues.find((issue) => issue.scope === "asset");
      if (validation.issues.some((issue) => issue.scope === "common")) {
        setCommonExpanded(true);
      }
      if (firstAssetIssue?.scope === "asset") {
        setExpandedDraftId(firstAssetIssue.clientDraftId);
      }
      setError(validation.message);
      return;
    }
    setBusy(true);
    setError("");
    const result = await createInstalledAssetsBatch({
      projectId,
      requestId,
      assets: drafts.map((draft) => ({
        clientDraftId: draft.clientDraftId,
        jobId: jobId || null,
        productId: draft.productId,
        assetKind: draft.assetKind,
        name: draft.name,
        brand: draft.brand || undefined,
        model: draft.model || undefined,
        serialNumber: draft.serialNumber || undefined,
        macAddress: draft.macAddress || undefined,
        ipAddress: draft.ipAddress || undefined,
        locationLabel,
        installedAt: new Date(`${installedOn}T09:00:00`).toISOString(),
        customerWarrantyEndsOn: warrantyEndsOn || null,
        note: note || undefined,
      })),
    });
    if (!result.ok) {
      setBusy(false);
      setError(t(result.error as never));
      return;
    }
    const assetIdByDraft = new Map(result.data.map((row) => [row.clientDraftId, row.assetId]));
    for (const draft of drafts) {
      const assetId = assetIdByDraft.get(draft.clientDraftId);
      if (!assetId) continue;
      for (let index = 0; index < draft.photos.length; index += 1) {
        const photo = draft.photos[index];
        if (photo.uploaded) continue;
        const form = new FormData();
        form.set("file", photo.file);
        form.set("sortOrder", String(index));
        form.set("isPrimary", String(index === 0));
        form.set("clientRequestId", photo.id);
        const response = await fetch(`/api/mobile/services/assets/${assetId}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          setBusy(false);
          setExpandedDraftId(draft.clientDraftId);
          setError(`Thiết bị ${drafts.indexOf(draft) + 1} “${draft.name}”: ảnh ${index + 1} chưa tải lên. Nhấn Lưu lại để tiếp tục.`);
          return;
        }
        updateDraft(draft.clientDraftId, {
          photos: draft.photos.map((item) => item.id === photo.id ? { ...item, uploaded: true } : item),
        });
        photo.uploaded = true;
      }
    }
    setBusy(false);
    resetAndClose();
    router.refresh();
  }

  function resetAndClose() {
    catalogDrafts.forEach(releaseDraftPhotos);
    releaseDraftPhotos(manualDraft);
    setOpen(false);
    setSource("catalog");
    setCatalogDrafts([]);
    setManualDraft(makeManualDraft(serviceType));
    setExpandedDraftId(null);
    setJobId("");
    setLocationLabel("");
    setInstalledOn(todayDate());
    setWarrantyEndsOn("");
    setNote("");
    setQuery("");
    setPickerOpen(true);
    setCommonExpanded(true);
    setError("");
    setRequestId(newRequestId(projectId));
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t("services.assets.create")}
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) resetAndClose();
        }}
        title="Thêm thiết bị đã lắp"
        closeLabel={t("common.close")}
        size="xl"
        footer={(
          <div className="flex w-full flex-col gap-2">
            {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetAndClose} disabled={busy}>Hủy</Button>
              <Button type="button" onClick={submit} disabled={!canSubmit || busy} loading={busy}>
                Lưu {drafts.length} thiết bị
              </Button>
            </div>
          </div>
        )}
      >
        <div className="space-y-5" data-installed-asset-batch-flow>
          <section aria-labelledby="asset-source-title">
            <h3 id="asset-source-title" className="mb-2 text-sm font-semibold text-slate-900">1. Chọn nguồn thiết bị</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <SourceCard
                icon={FolderSearch}
                title="Chọn từ sản phẩm"
                subtitle="Liên kết sản phẩm, tự điền thông tin"
                selected={source === "catalog"}
                onClick={() => chooseSource("catalog")}
              />
              <SourceCard
                icon={SquarePen}
                title="Nhập thủ công"
                subtitle="Tạo thiết bị không liên kết sản phẩm"
                selected={source === "manual"}
                onClick={() => chooseSource("manual")}
              />
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-3">
              {source === "catalog" ? (
                <section aria-labelledby="asset-product-title">
                <h3 id="asset-product-title" className="mb-2 text-sm font-semibold text-slate-900">2. Tìm & chọn sản phẩm</h3>
                <div
                  ref={pickerRef}
                  className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                  onKeyDownCapture={(event) => {
                    if (event.key !== "Escape" || !pickerOpen) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setPickerOpen(false);
                  }}
                >
                  <div className="relative border-b border-border-soft p-3">
                    <Search aria-hidden="true" className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onFocus={() => setPickerOpen(true)}
                      onClick={() => setPickerOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setPickerOpen(true);
                          requestAnimationFrame(() => {
                            pickerRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
                          });
                        }
                      }}
                      placeholder="Tìm sản phẩm theo tên, SKU hoặc model"
                      aria-label="Tìm sản phẩm theo tên, SKU hoặc model"
                      aria-expanded={pickerOpen}
                      aria-controls="installed-asset-product-listbox"
                      className="pl-9"
                    />
                  </div>
                  {pickerOpen && (
                    <>
                      <div
                        id="installed-asset-product-listbox"
                        role="listbox"
                        aria-label="Chọn nhiều sản phẩm"
                        aria-multiselectable="true"
                        className="max-h-72 divide-y divide-border-soft overflow-y-auto"
                      >
                        {catalogFeedback.state === "loading" ? (
                          <div role="status" className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                            <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
                            {catalogFeedback.message}
                          </div>
                        ) : catalogFeedback.state === "error" ? (
                          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-slate-500">
                            <span>{catalogFeedback.message}</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => void refreshCatalog()}>
                              Thử lại
                            </Button>
                          </div>
                        ) : (
                          <>
                            {visibleProducts.map((product) => (
                              <ProductOption
                                key={product.id}
                                product={product}
                                selected={selectedIds.has(product.id)}
                                onToggle={() => void toggleProduct(product)}
                              />
                            ))}
                            {visibleProducts.length === 0 && (
                              <div className="px-4 py-10 text-center text-sm text-slate-500">Không tìm thấy sản phẩm phù hợp.</div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-border-soft bg-surface-2 px-3 py-2">
                        <span className="text-xs text-slate-600">Đã chọn {selectedProductCount} sản phẩm</span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={selectedProductCount === 0}
                          onClick={() => setPickerOpen(false)}
                        >
                          Thêm {selectedProductCount} sản phẩm
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                </section>
              ) : (
                <section aria-labelledby="asset-manual-title">
                  <h3 id="asset-manual-title" className="mb-2 text-sm font-semibold text-slate-900">2. Thiết bị nhập thủ công</h3>
                  <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 p-5 text-sm text-primary-800">
                    Nhập thông tin cho một thiết bị không liên kết danh mục sản phẩm.
                  </div>
                </section>
              )}
              <div className="flex items-start gap-2 text-xs text-slate-500">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                Chỉ liên kết thông tin sản phẩm, không tạo phiếu xuất và không trừ số lượng kho.
              </div>
            </div>

            <section aria-labelledby="asset-common-title">
              <button
                type="button"
                onClick={() => setCommonExpanded((value) => !value)}
                aria-expanded={commonExpanded}
                aria-controls="installed-asset-common-fields"
                className="mb-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-slate-900"
              >
                <span id="asset-common-title">3. Thông tin áp dụng chung</span>
                {commonExpanded ? (
                  <ChevronUp aria-hidden="true" className="h-4 w-4 text-slate-500" />
                ) : (
                  <ChevronDown aria-hidden="true" className="h-4 w-4 text-slate-500" />
                )}
              </button>
              {commonExpanded && <div id="installed-asset-common-fields" className="grid gap-3">
                <Field label="Công việc (tùy chọn)">
                  <SearchableSelect
                    value={jobId}
                    showSearch
                    onChange={setJobId}
                    allowClear={false}
                    placeholder="Không gắn lệnh việc"
                    options={[
                      { value: "", label: "Không gắn lệnh việc" },
                      ...jobs.map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` })),
                    ]}
                  />
                </Field>
                <Field label="Vị trí lắp đặt" required>
                  <Input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} />
                </Field>
                <Field label="Ngày lắp đặt" required>
                  <Input type="date" value={installedOn} onChange={(event) => setInstalledOn(event.target.value)} />
                </Field>
                <Field label="Bảo hành cho khách đến ngày (tùy chọn)">
                  <Input type="date" value={warrantyEndsOn} onChange={(event) => setWarrantyEndsOn(event.target.value)} />
                </Field>
                <Field label="Ghi chú (tùy chọn)">
                  <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
                </Field>
              </div>}
            </section>
          </div>

          <section aria-labelledby="asset-drafts-title">
            <h3 id="asset-drafts-title" className="mb-1 text-sm font-semibold text-slate-900">4. Thiết bị đã chọn ({drafts.length})</h3>
            <p className="mb-3 text-xs text-slate-500">Ảnh catalog chỉ để tham khảo, không thay thế ảnh lắp đặt.</p>
            {drafts.length === 0 ? (
              <button
                type="button"
                onClick={() => chooseSource("catalog")}
                className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-slate-500 hover:border-primary-400 hover:text-primary-700"
              >
                <PackageSearch aria-hidden="true" className="h-6 w-6" />
                Chọn nhiều sản phẩm để tạo thiết bị
              </button>
            ) : (
              <div className="space-y-2">
                {drafts.map((draft, index) => (
                  <div key={draft.clientDraftId} className="space-y-2">
                    {source === "catalog" && draft.productId && catalogDrafts.findIndex(
                      (item) => item.productId === draft.productId,
                    ) === index && (
                      <ProductQuantityRow
                        draft={draft}
                        quantity={catalogDrafts.filter((item) => item.productId === draft.productId).length}
                        max={INSTALLED_ASSET_BATCH_LIMIT - catalogDrafts.filter(
                          (item) => item.productId !== draft.productId,
                        ).length}
                        disabled={busy}
                        onChange={(quantity) => {
                          const product = products.find((item) => item.id === draft.productId);
                          if (product) void updateProductQuantity(product, quantity);
                        }}
                      />
                    )}
                    <DraftCard
                      draft={draft}
                      index={index}
                      expanded={expandedDraftId === draft.clientDraftId}
                      complete={Boolean(
                        locationLabel.trim()
                        && installedOn
                        && draft.name.trim()
                        && draft.assetKind.trim()
                        && draft.serialNumber.trim()
                        && draft.photos.length,
                      )}
                      canDelete={source === "catalog"}
                      onToggle={() => setExpandedDraftId(
                        expandedDraftId === draft.clientDraftId ? null : draft.clientDraftId,
                      )}
                      onDelete={() => void removeDraft(draft.clientDraftId)}
                      onChange={(patch) => updateDraft(draft.clientDraftId, patch)}
                      onFiles={(files) => addPhotos(draft.clientDraftId, files)}
                      onRemovePhoto={(photoId) => removePhoto(draft.clientDraftId, photoId)}
                      onSetPrimary={(photoId) => makePrimaryPhoto(draft.clientDraftId, photoId)}
                      onMovePhoto={(fromPhotoId, toPhotoId) => movePhoto(draft.clientDraftId, fromPhotoId, toPhotoId)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </RowPreviewModal>
    </>
  );
}

function ProductQuantityRow({
  draft,
  quantity,
  max,
  disabled,
  onChange,
}: {
  draft: AssetDraft;
  quantity: number;
  max: number;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-primary-50/45 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{draft.name}</p>
        <p className="text-xs text-slate-500">Mỗi đơn vị tạo một hồ sơ thiết bị riêng.</p>
      </div>
      <Field label="Số lượng" className="w-full shrink-0 sm:w-40">
        <QuantityInput
          value={quantity}
          min={1}
          max={max}
          decimals={0}
          disabled={disabled}
          onChange={onChange}
          decrementLabel={`Giảm số lượng ${draft.name}`}
          inputLabel={`Số lượng ${draft.name}`}
          incrementLabel={`Tăng số lượng ${draft.name}`}
        />
      </Field>
    </div>
  );
}

function SourceCard({
  icon: Icon,
  title,
  subtitle,
  selected,
  onClick,
}: {
  icon: typeof PackageSearch;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-20 min-w-11 items-center gap-3 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary-600 bg-primary-50 text-primary-800"
          : "border-border bg-surface text-slate-700 hover:border-primary-300",
      )}
    >
      <Icon aria-hidden="true" className="h-7 w-7 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs text-slate-500">{subtitle}</span>
      </span>
      <span className={cn(
        "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
        selected ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300",
      )}>
        {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

function ProductOption({
  product,
  selected,
  onToggle,
}: {
  product: ProductCatalogItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const options = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
        );
        const currentIndex = options.indexOf(event.currentTarget);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : event.key === "ArrowDown"
              ? Math.min(options.length - 1, currentIndex + 1)
              : Math.max(0, currentIndex - 1);
        options[nextIndex]?.focus();
      }}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2",
        selected && "bg-primary-50/70",
      )}
    >
      <span className={cn(
        "grid h-5 w-5 shrink-0 place-items-center rounded border",
        selected ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white",
      )}>
        {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <CatalogThumb product={product} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{product.name}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          SKU: {product.sku}
          {product.brandName ? ` · Thương hiệu: ${product.brandName}` : ""}
          {product.model ? ` · Model: ${product.model}` : ""}
        </span>
      </span>
    </button>
  );
}

function DraftCard({
  draft,
  index,
  expanded,
  complete,
  canDelete,
  onToggle,
  onDelete,
  onChange,
  onFiles,
  onRemovePhoto,
  onSetPrimary,
  onMovePhoto,
}: {
  draft: AssetDraft;
  index: number;
  expanded: boolean;
  complete: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onChange: (patch: Partial<AssetDraft>) => void;
  onFiles: (files: FileList | null) => void;
  onRemovePhoto: (photoId: string) => void;
  onSetPrimary: (photoId: string) => void;
  onMovePhoto: (fromPhotoId: string, toPhotoId: string) => void;
}) {
  const inputId = `asset-photos-${draft.clientDraftId}`;
  const photoOrderLocked = draft.photos.some((photo) => photo.uploaded);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex min-h-16 items-center gap-3 px-3 py-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary-700 text-xs font-bold text-white">{index + 1}</span>
        {draft.catalogImageUrl && <Image src={draft.catalogImageUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-lg border border-border object-contain p-1" unoptimized />}
        <button type="button" onClick={onToggle} className="min-h-11 min-w-11 flex-1 text-left">
          <span className="block truncate text-sm font-semibold text-slate-900">{draft.name || "Thiết bị nhập thủ công"}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {draft.sku ? `SKU: ${draft.sku} · ` : ""}Loại: {draft.assetKind || "Chưa nhập"}
          </span>
        </button>
        <span className={cn(
          "hidden rounded-md px-2 py-1 text-[11px] font-semibold sm:inline-flex",
          complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
        )}>
          {complete ? "Sẵn sàng lưu" : "Cần bổ sung thông tin"}
        </span>
        {canDelete && (
          <Button type="button" variant="ghost" size="icon" onClick={onDelete} aria-label="Xóa thiết bị">
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        )}
        <button type="button" onClick={onToggle} className="grid h-11 w-11 place-items-center rounded-lg" aria-label={expanded ? "Thu gọn" : "Mở rộng"}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="grid gap-4 border-t border-border-soft p-4 lg:grid-cols-[1fr_1fr_1.35fr]">
          <div className="grid content-start gap-3">
            <Field label="Tên thiết bị" required>
              <Input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
            </Field>
            <Field label="Loại thiết bị" required>
              <Input value={draft.assetKind} onChange={(event) => onChange({ assetKind: event.target.value })} />
            </Field>
            <Field label="Thương hiệu">
              <Input value={draft.brand} onChange={(event) => onChange({ brand: event.target.value })} />
            </Field>
            <Field label="Model">
              <Input value={draft.model} onChange={(event) => onChange({ model: event.target.value })} />
            </Field>
          </div>
          <div className="grid content-start gap-3">
            <Field label="Serial">
              <Input value={draft.serialNumber} onChange={(event) => onChange({ serialNumber: event.target.value })} />
            </Field>
            <Field label="MAC">
              <Input value={draft.macAddress} onChange={(event) => onChange({ macAddress: event.target.value })} />
            </Field>
            <Field label="Địa chỉ IP">
              <Input value={draft.ipAddress} onChange={(event) => onChange({ ipAddress: event.target.value })} />
            </Field>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Ảnh thiết bị</div>
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="sr-only"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor={inputId}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  onFiles(event.dataTransfer.files);
                }}
                className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-primary-500 hover:text-primary-700"
              >
                <Plus aria-hidden="true" className="h-5 w-5" />
                Tải ảnh
              </label>
              {draft.photos.map((photo, photoIndex) => (
                <div
                  key={photo.id}
                  draggable={!photoOrderLocked}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", photo.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromPhotoId = event.dataTransfer.getData("text/plain");
                    if (fromPhotoId) onMovePhoto(fromPhotoId, photo.id);
                  }}
                  className="relative h-24 w-24 overflow-hidden rounded-lg border border-border bg-surface-2"
                >
                  <button
                    type="button"
                    onClick={() => onSetPrimary(photo.id)}
                    disabled={photoOrderLocked || photoIndex === 0}
                    className="block h-full min-h-11 w-full min-w-11"
                    aria-label={photoIndex === 0 ? "Ảnh chính" : `Đặt ảnh ${photoIndex + 1} làm ảnh chính`}
                    title={photoOrderLocked
                      ? "Thứ tự đã khóa sau khi bắt đầu tải lên"
                      : photoIndex === 0 ? "Ảnh chính" : "Đặt làm ảnh chính"}
                  >
                    <Image src={photo.previewUrl} alt={`Ảnh thiết bị ${photoIndex + 1}`} width={96} height={96} className="h-full w-full object-cover" unoptimized />
                    {photoIndex === 0 && <span className="absolute bottom-1 left-1 rounded bg-primary-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">Ảnh chính</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePhoto(photo.id)}
                    disabled={photo.uploaded}
                    className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full text-slate-700 disabled:text-primary-700"
                    aria-label={photo.uploaded ? "Ảnh đã tải lên" : "Xóa ảnh"}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white shadow">
                      {photo.uploaded ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Tối đa 8 ảnh · JPG, PNG, WebP hoặc HEIC.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogThumb({ product }: { product: ProductCatalogItem }) {
  const imageUrl = product.imageUrls?.[0];
  return imageUrl
    ? <Image src={imageUrl} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-lg border border-border object-contain p-1" unoptimized />
    : (
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-slate-400">
        <PackageSearch aria-hidden="true" className="h-5 w-5" />
      </span>
    );
}

function makeCatalogDraft(product: ProductCatalogItem, serviceType?: string | null): AssetDraft {
  return {
    clientDraftId: `product-${product.id}-${crypto.randomUUID()}`,
    productId: product.id,
    sku: product.sku,
    catalogImageUrl: product.imageUrls?.[0] ?? null,
    name: product.name,
    assetKind: product.categoryName?.trim().toLowerCase() || defaultAssetKind(serviceType),
    brand: product.brandName ?? "",
    model: product.model?.trim() ?? "",
    serialNumber: "",
    macAddress: "",
    ipAddress: "",
    photos: [],
    edited: false,
  };
}

function makeManualDraft(serviceType?: string | null): AssetDraft {
  return {
    clientDraftId: "manual-device",
    productId: null,
    sku: null,
    catalogImageUrl: null,
    name: "",
    assetKind: defaultAssetKind(serviceType),
    brand: "",
    model: "",
    serialNumber: "",
    macAddress: "",
    ipAddress: "",
    photos: [],
    edited: false,
  };
}

function defaultAssetKind(serviceType?: string | null) {
  if (serviceType === "electrical") return "thiết bị điện";
  if (serviceType === "plumbing") return "thiết bị nước";
  return "camera";
}

function releaseDraftPhotos(draft: AssetDraft) {
  draft.photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
}

function hasDraftUserData(draft: AssetDraft) {
  return draft.edited || draft.photos.length > 0;
}

function todayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function newRequestId(projectId: string) {
  return `project-assets-${projectId.slice(0, 8)}-${crypto.randomUUID()}`;
}

function isAcceptedAssetPhoto(file: File) {
  if (file.size > 15 * 1024 * 1024) return false;
  const type = file.type.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type)) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}
