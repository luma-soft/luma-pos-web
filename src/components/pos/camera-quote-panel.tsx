"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { CameraPickerModal, type CameraPickerProduct } from "@/components/pos/camera-picker-modal";
import {
  CAMERA_QUOTE_CARD_SKUS,
  CAMERA_QUOTE_DETAIL_MATERIAL_SKUS,
  CAMERA_QUOTE_INSTALL_SKUS,
  CAMERA_QUOTE_MATERIAL_SKUS,
} from "@/lib/data/camera-quote-constants";
import type { PosProduct } from "@/lib/data/pos";
import { formatCurrency } from "@/lib/utils";

export type CameraQuoteMaterialLine = { productId: string; quantity: number };
export type CameraQuotePackage = {
  key: string;
  cameraId: string;
  cardId: string;
  installationId: string;
  materialLines: CameraQuoteMaterialLine[];
  quantity: number;
};

type Props = {
  products: PosProduct[];
  packages: CameraQuotePackage[];
  priceBook: string;
  onChange: (packages: CameraQuotePackage[]) => void;
};

const cameraPrefixes = ["EZ-", "IM-"];

function isCamera(product: PosProduct) {
  if (product.isVariantParent) return false;
  const sku = (product.sku ?? "").trim().toUpperCase();
  const category = (product.categoryName ?? "").trim().toLocaleLowerCase("vi");
  const name = product.name.toLocaleLowerCase("vi");
  return category === "camera giám sát" ||
    cameraPrefixes.some((prefix) => sku.startsWith(prefix)) ||
    name.startsWith("ezviz ") || name.startsWith("imou ");
}

function label(product: PosProduct) {
  return `${product.name} · ${formatCurrency(Number(product.retailPrice))}`;
}

function unitLabel(product?: PosProduct) {
  const unit = product?.baseUnit?.trim();
  if (!unit || unit.toLocaleLowerCase("vi") === "điểm") return "";
  return unit.toLocaleLowerCase("vi") === "cái" ? "cái" : unit.toLocaleLowerCase("vi") === "cuộn" ? "cuộn" : unit;
}

function keyFor(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function CameraQuotePanel({ products, packages, priceBook, onChange }: Props) {
  const t = useTranslations();
  const [pickerOpen, setPickerOpen] = useState(false);
  const bySku = new Map(products.flatMap((product) => [[product.sku ?? "", product]]));
  const byId = new Map(products.map((product) => [product.id, product]));
  const cameras = products.filter(isCamera).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const pickerCameras: CameraPickerProduct[] = cameras.map((product) => ({
    id: product.id,
    sku: product.sku ?? "",
    name: product.name,
    retailPrice: Number(product.retailPrice),
    imageUrl: Array.isArray(product.imageUrls) && typeof product.imageUrls[0] === "string" ? product.imageUrls[0] : null,
  }));
  const cards = CAMERA_QUOTE_CARD_SKUS.flatMap((sku) => {
    const product = bySku.get(sku);
    return product ? [product] : [];
  });
  const installations = CAMERA_QUOTE_INSTALL_SKUS.flatMap((sku) => {
    const product = bySku.get(sku);
    return product ? [product] : [];
  });
  const materialSkus = new Set<string>([
    ...CAMERA_QUOTE_MATERIAL_SKUS,
    ...CAMERA_QUOTE_DETAIL_MATERIAL_SKUS,
  ]);
  const materials = products.filter((product) =>
    materialSkus.has(product.sku ?? "") ||
    Boolean(product.specs && typeof product.specs === "object" && !Array.isArray(product.specs) && (product.specs as Record<string, unknown>).__cameraQuoteMaterial === true),
  );
  const selectedCameras = packages.reduce<Record<string, number>>((counts, pkg) => {
    counts[pkg.cameraId] = (counts[pkg.cameraId] ?? 0) + pkg.quantity;
    return counts;
  }, {});
  const genericMaterialIds = new Set(
    CAMERA_QUOTE_MATERIAL_SKUS.flatMap((sku) => {
      const product = bySku.get(sku);
      return product ? [product.id] : [];
    }),
  );

  function defaultMaterial() {
    const product = materials.find((item) => genericMaterialIds.has(item.id)) ?? materials[0];
    return product ? { productId: product.id, quantity: 1 } : null;
  }

  function addCamera(cameraId: string) {
    if (!cameraId) return;
    const card = cards.find((item) => item.sku === "MEM-IMOU-64GB") ?? cards[0];
    const installation = installations.find((item) => item.sku === "SVC-CAM-INSTALL-200") ?? installations[0];
    const material = defaultMaterial();
    if (!card || !installation || !material) return;
    const existing = packages.find((pkg) =>
      pkg.cameraId === cameraId &&
      pkg.cardId === card.id &&
      pkg.installationId === installation.id &&
      pkg.materialLines.length === 1 &&
      pkg.materialLines[0]?.productId === material.productId &&
      pkg.materialLines[0]?.quantity === material.quantity,
    );
    if (existing) {
      updatePackage(existing.key, { quantity: Math.min(99, existing.quantity + 1) });
      return;
    }
    onChange([
      ...packages,
      {
        key: keyFor("camera-package"),
        cameraId,
        cardId: card.id,
        installationId: installation.id,
        materialLines: [material],
        quantity: 1,
      },
    ]);
  }

  function updatePackage(key: string, patch: Partial<CameraQuotePackage>) {
    onChange(packages.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function updateMaterial(pkg: CameraQuotePackage, index: number, productId: string) {
    const isGeneric = genericMaterialIds.has(productId);
    const nextLines = pkg.materialLines.map((line, lineIndex) => lineIndex === index ? { ...line, productId } : line);
    const materialLines = isGeneric
      ? [nextLines[index] ?? { productId, quantity: 1 }]
      : nextLines.filter((line) => !genericMaterialIds.has(line.productId));
    updatePackage(pkg.key, { materialLines });
  }

  function packageTotal(pkg: CameraQuotePackage) {
    const getPrice = (id: string) => Number(byId.get(id)?.prices?.[priceBook] ?? byId.get(id)?.retailPrice ?? 0);
    const base = getPrice(pkg.cameraId) + getPrice(pkg.cardId) + getPrice(pkg.installationId);
    const material = pkg.materialLines.reduce((sum, line) => sum + getPrice(line.productId) * line.quantity, 0);
    return (base + material) * pkg.quantity;
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold">{t("pos.cameraQuote.title")}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{t("pos.cameraQuote.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4" />{t("pos.cameraQuote.addCamera")}</Button>
        </div>
      </div>

      {packages.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-slate-500">
          {t("pos.cameraQuote.empty")}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {packages.map((pkg, index) => {
            const camera = byId.get(pkg.cameraId);
            return (
              <article key={pkg.key} className="rounded-xl border border-border-soft bg-canvas/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-primary-600">
                      {t("pos.cameraQuote.package", { n: String(index + 1).padStart(2, "0") })}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Select
                        size="sm"
                        className="min-w-0 flex-1"
                        value={pkg.cameraId}
                        options={cameras.map((product) => ({ value: product.id, label: label(product) }))}
                        onValueChange={(cameraId) => updatePackage(pkg.key, { cameraId })}
                      />
                      <div className="grid h-9 shrink-0 grid-cols-[32px_42px_32px] overflow-hidden rounded-md border border-border bg-surface">
                        <button type="button" disabled={pkg.quantity <= 1} onClick={() => updatePackage(pkg.key, { quantity: Math.max(1, pkg.quantity - 1) })} className="grid place-items-center text-slate-500 hover:bg-surface-2 hover:text-er disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="grid place-items-center border-x border-border text-sm font-semibold tabular-nums">{pkg.quantity}</span>
                        <button type="button" disabled={pkg.quantity >= 99} onClick={() => updatePackage(pkg.key, { quantity: Math.min(99, pkg.quantity + 1) })} className="grid place-items-center text-slate-500 hover:bg-surface-2 hover:text-primary-600 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">{camera?.sku}</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    aria-label={t("pos.cameraQuote.removePackage")}
                    onClick={() => onChange(packages.filter((item) => item.key !== pkg.key))}
                  >
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Select
                    size="sm"
                    value={pkg.cardId}
                    options={cards.map((product) => ({ value: product.id, label: label(product) }))}
                    onValueChange={(cardId) => updatePackage(pkg.key, { cardId })}
                  />
                  <Select
                    size="sm"
                    value={pkg.installationId}
                    options={installations.map((product) => ({ value: product.id, label: label(product) }))}
                    onValueChange={(installationId) => updatePackage(pkg.key, { installationId })}
                  />
                </div>

                <div className="mt-3 rounded-lg border border-border-soft bg-surface p-2">
                  <div className="mb-2 text-xs font-semibold text-slate-500">{t("pos.cameraQuote.materials")}</div>
                  <div className="grid gap-2">
                    {pkg.materialLines.map((line, materialIndex) => {
                      const product = byId.get(line.productId);
                      return (
                        <div key={`${pkg.key}-${line.productId}-${materialIndex}`} className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2">
                          <Select
                            size="sm"
                            value={line.productId}
                            options={materials.map((item) => ({ value: item.id, label: label(item) }))}
                            onValueChange={(productId) => updateMaterial(pkg, materialIndex, productId)}
                          />
                          <NumberInput
                            size="sm"
                            value={line.quantity}
                            min={0.01}
                            decimals={2}
                            thousandSeparator={false}
                            suffix={unitLabel(product) ? ` ${unitLabel(product)}` : ""}
                            onChange={(quantity) => updatePackage(pkg.key, {
                              materialLines: pkg.materialLines.map((item, itemIndex) => itemIndex === materialIndex ? { ...item, quantity: Math.max(0.01, quantity ?? 1) } : item),
                            })}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="iconSm"
                            disabled={pkg.materialLines.length === 1}
                            aria-label={t("pos.cameraQuote.removeMaterial")}
                            onClick={() => updatePackage(pkg.key, { materialLines: pkg.materialLines.filter((_, itemIndex) => itemIndex !== materialIndex) })}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="mt-2 px-0"
                    onClick={() => {
                      const product = materials.find((item) => !genericMaterialIds.has(item.id)) ?? materials[0];
                      if (!product) return;
                      updatePackage(pkg.key, { materialLines: [...pkg.materialLines, { productId: product.id, quantity: 1 }] });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("pos.cameraQuote.addMaterial")}
                  </Button>
                </div>

                <div className="mt-3 flex items-center justify-end gap-3 border-t border-border-soft pt-3">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400">{t("pos.cameraQuote.packageTotal")}</div>
                    <div className="font-black tabular-nums text-primary-700">{formatCurrency(packageTotal(pkg))}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <CameraPickerModal
        open={pickerOpen}
        cameras={pickerCameras}
        selectedCameras={selectedCameras}
        onClose={() => setPickerOpen(false)}
        onSelect={(camera) => addCamera(camera.id)}
      />
    </section>
  );
}
