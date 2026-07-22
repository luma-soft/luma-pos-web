"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Camera,
  CheckCircle2,
  FileText,
  Minus,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import { createOrder } from "@/lib/actions/orders";
import type {
  CameraQuoteFormOptions,
  CameraQuoteProductOption,
} from "@/lib/data/camera-quotes";
import { Routes } from "@/lib/routes";
import { Select } from "@/components/ui/select";

type PackageRow = {
  key: string;
  cameraId: string;
  cardId: string;
  installationId: string;
  materialLines: Array<{ productId: string; quantity: number }>;
  quantity: number;
};

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const indoorCameraPrefixes = [
  "EZ-C1CB",
  "EZ-H1C",
  "EZ-H6C",
  "EZ-C6N",
  "EZ-C60P",
  "IM-A32",
];
const fixedOutdoorPrefixes = ["EZ-H3C", "IM-F32"];

function utilityDefaults(cameraSku: string, options: CameraQuoteFormOptions) {
  const indoor = indoorCameraPrefixes.some((prefix) => cameraSku.startsWith(prefix));
  const fixedOutdoor = fixedOutdoorPrefixes.some((prefix) => cameraSku.startsWith(prefix));
  const index = indoor ? 0 : fixedOutdoor ? 1 : 2;
  return {
    installationId: options.installations[index].id,
    materialLines: [{ productId: options.materials[index].id, quantity: 1 }],
  };
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function CameraQuoteBuilder({ options }: { options: CameraQuoteFormOptions }) {
  const t = useTranslations("quotes");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [projectName, setProjectName] = useState(() => t("projectPlaceholder"));
  const [note, setNote] = useState(() => t("defaultNote"));
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const productById = useMemo(() => {
    const all = [
      ...options.cameras,
      ...options.cards,
      ...options.installations,
      ...options.materials,
    ];
    return new Map(all.map((product) => [product.id, product]));
  }, [options]);

  const filteredCameras = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("vi");
    if (!q) return options.cameras;
    return options.cameras.filter((camera) =>
      `${camera.name} ${camera.sku} ${camera.description ?? ""}`
        .toLocaleLowerCase("vi")
        .includes(q),
    );
  }, [options.cameras, search]);

  const quoteTotal = packages.reduce((sum, row) => sum + packageTotal(row, productById), 0);
  const cameraCount = packages.reduce((sum, row) => sum + row.quantity, 0);

  function addCamera(camera: CameraQuoteProductOption) {
    const defaults = utilityDefaults(camera.sku, options);
    setPackages((current) => [
      ...current,
      {
        key: newKey(),
        cameraId: camera.id,
        cardId: options.cards[1]?.id ?? options.cards[0].id,
        installationId: defaults.installationId,
        materialLines: defaults.materialLines,
        quantity: 1,
      },
    ]);
    setError(null);
  }

  function updatePackage(key: string, patch: Partial<PackageRow>) {
    setPackages((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removePackage(key: string) {
    setPackages((current) => current.filter((row) => row.key !== key));
  }

  function save(openPrint: boolean) {
    if (packages.length === 0) {
      setError(t("builderErrors.addCamera"));
      return;
    }
    if (!options.defaultWarehouseId) {
      setError(t("builderErrors.noWarehouse"));
      return;
    }

    setError(null);
    startTransition(async () => {
      const items = packages.flatMap((row) => {
        const selected = [
          productById.get(row.cameraId),
          productById.get(row.cardId),
          productById.get(row.installationId),
        ].flatMap((product) =>
          product
            ? [
                {
                  productId: product.id,
                  productName: product.name,
                  unitName: product.baseUnit,
                  quantity: row.quantity,
                },
              ]
            : [],
        );
        return [
          ...selected,
          ...row.materialLines.flatMap((line) => {
            const product = productById.get(line.productId);
            return product
              ? [{
                  productId: product.id,
                  productName: product.name,
                  unitName: product.baseUnit,
                  quantity: row.quantity * line.quantity,
                }]
              : [];
          }),
        ];
      });

      const result = await createOrder({
        mode: "quote",
        clientId: crypto.randomUUID(),
        customerId: customerId || null,
        warehouseId: options.defaultWarehouseId!,
        projectName: projectName.trim() || t("projectPlaceholder"),
        note: note.trim(),
        discount: 0,
        taxRate: 0,
        shippingFee: 0,
        items,
        payment: { method: "credit", amount: 0 },
      });

      if (!result.ok) {
        setError(t("builderErrors.saveFailed"));
        return;
      }

      router.push(
        openPrint
          ? `${Routes.order(result.data.id)}/print?size=a4`
          : Routes.salesOrder(result.data.id, "quote"),
      );
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
      <section className="min-w-0 space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 text-sm font-medium">
              <span>{t("customerLabel")}</span>
              <div className="[&>div]:block [&>div]:w-full">
                <Select
                  className="w-full"
                  options={[
                    { value: "", label: t("customerPlaceholder") },
                    ...options.customers.map((customer) => ({
                      value: customer.id,
                      label: `${customer.name}${customer.phone ? ` - ${customer.phone}` : ""}`,
                    })),
                  ]}
                  value={customerId}
                  onValueChange={setCustomerId}
                />
              </div>
            </div>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{t("projectLabel")}</span>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              />
            </label>
          </div>
          <label className="mt-4 block space-y-1.5 text-sm font-medium">
            <span>{t("noteLabel")}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-5"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t("cameraPickerTitle")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("cameraPickerHint")}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("cameraSearchPlaceholder")}
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {filteredCameras.map((camera) => (
              <CameraOptionCard key={camera.id} camera={camera} onAdd={() => addCamera(camera)} />
            ))}
          </div>
        </div>
      </section>

      <aside className="min-w-0">
        <div className="space-y-4 xl:sticky xl:top-20">
          <div className="rounded-2xl border border-border bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-4">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100">{t("packagesTitle")}</h2>
                <p className="mt-0.5 text-xs text-slate-500">{t("packageCount", { cameraCount, packageCount: packages.length })}</p>
              </div>
              <FileText className="h-5 w-5 text-primary-600" />
            </div>

            {packages.length === 0 ? (
              <div className="px-6 py-14 text-center text-slate-400">
                <Camera className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="font-medium">{t("emptyPackagesTitle")}</p>
                <p className="mt-1 text-sm">{t("emptyPackagesHint")}</p>
              </div>
            ) : (
              <div className="max-h-[calc(100vh-360px)] space-y-3 overflow-y-auto p-3">
                {packages.map((row, index) => (
                  <PackageEditor
                    key={row.key}
                    index={index}
                    row={row}
                    productById={productById}
                    options={options}
                    onChange={(patch) => updatePackage(row.key, patch)}
                    onRemove={() => removePackage(row.key)}
                  />
                ))}
              </div>
            )}

            <div className="border-t border-border-soft p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("totalLabel")}</div>
                  <div className="mt-1 text-2xl font-black tabular-nums text-primary-700">{money.format(quoteTotal)}</div>
                </div>
                <div className="text-right text-xs whitespace-pre-line text-slate-500">{t("unexpectedCosts")}</div>
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={isPending || packages.length === 0}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 text-sm font-bold text-primary-700 hover:bg-primary-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isPending ? t("saving") : t("saveQuote")}
                </button>
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={isPending || packages.length === 0}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  {t("saveAndPrint")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CameraOptionCard({
  camera,
  onAdd,
}: {
  camera: CameraQuoteProductOption;
  onAdd: () => void;
}) {
  const t = useTranslations("quotes");
  const resolution = camera.specs["Độ phân giải"]?.[0];
  const connection = camera.specs["Kết nối"]?.[0];
  return (
    <article className="flex min-h-44 flex-col rounded-xl border border-border-soft bg-canvas/40 p-3 transition hover:border-primary-300 hover:shadow-sm">
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-white">
          {camera.imageUrl ? (
            <Image src={camera.imageUrl} alt={camera.name} fill sizes="80px" className="object-contain p-1" unoptimized />
          ) : (
            <div className="grid h-full place-items-center text-slate-300"><Camera className="h-8 w-8" /></div>
          )}
        </div>
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-bold text-slate-900 dark:text-slate-100">{camera.name}</div>
          <div className="mt-1 text-xs text-slate-400">{camera.sku}</div>
          <div className="mt-2 text-base font-black tabular-nums text-primary-700">{money.format(camera.retailPrice)}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-xs leading-4 text-slate-500">
        {resolution && <div className="line-clamp-1">• {resolution}</div>}
        {connection && <div className="line-clamp-1">• {connection}</div>}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white hover:bg-primary-700"
      >
        <Plus className="h-4 w-4" /> {t("addToQuote")}
      </button>
    </article>
  );
}

function PackageEditor({
  index,
  row,
  productById,
  options,
  onChange,
  onRemove,
}: {
  index: number;
  row: PackageRow;
  productById: Map<string, CameraQuoteProductOption>;
  options: CameraQuoteFormOptions;
  onChange: (patch: Partial<PackageRow>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("quotes");
  const camera = productById.get(row.cameraId)!;
  const total = packageTotal(row, productById);
  return (
    <div className="rounded-xl border border-border-soft bg-canvas/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-primary-600">{t("packageLabel", { number: String(index + 1).padStart(2, "0") })}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-bold">{camera.name}</div>
          <div className="mt-1 text-xs text-slate-400">{camera.sku}</div>
        </div>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={t("removePackage")}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        <QuoteSelect label={t("memoryLabel")} value={row.cardId} options={options.cards} onChange={(cardId) => onChange({ cardId })} />
        <QuoteSelect label={t("installationLabel")} value={row.installationId} options={options.installations} onChange={(installationId) => onChange({ installationId })} />
        {row.materialLines.map((line, materialIndex) => (
          <div key={`${row.key}-material-${materialIndex}`} className="grid grid-cols-[minmax(0,1fr)_56px_32px] items-center gap-2">
            <QuoteSelect label={materialIndex === 0 ? t("materialLabel") : ""} value={line.productId} options={options.materials} onChange={(productId) => onChange({ materialLines: row.materialLines.map((item, index) => index === materialIndex ? { ...item, productId } : item) })} />
            <input
              type="number"
              min={0.01}
              step="any"
              value={line.quantity}
              onChange={(event) => onChange({ materialLines: row.materialLines.map((item, index) => index === materialIndex ? { ...item, quantity: Math.max(0.01, Number(event.target.value) || 0.01) } : item) })}
              className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-center text-xs"
              aria-label={t("materialQuantity")}
            />
            <button
              type="button"
              onClick={() => onChange({ materialLines: row.materialLines.filter((_, index) => index !== materialIndex) })}
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t("removeMaterial")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ materialLines: [...row.materialLines, { productId: options.materials[0]?.id ?? "", quantity: 1 }] })}
          className="justify-self-start text-xs font-semibold text-primary-600 hover:text-primary-700"
        >
          + {t("addMaterial")}
        </button>
      </div>

      <details className="mt-3 rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-600">{t("cameraSpecs")}</summary>
        <dl className="mt-2 divide-y divide-border-soft">
          {Object.entries(camera.specs).map(([label, values]) => (
            <div key={label} className="grid grid-cols-[110px_1fr] gap-2 py-1.5">
              <dt className="font-semibold text-slate-500">{label}</dt>
              <dd className="text-slate-700 dark:text-slate-300">{values.join(", ")}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-3">
        <div className="inline-flex items-center rounded-lg border border-border bg-surface">
          <button type="button" onClick={() => onChange({ quantity: Math.max(1, row.quantity - 1) })} className="p-2 text-slate-500 hover:text-primary-700" aria-label={t("decreaseQuantity")}><Minus className="h-3.5 w-3.5" /></button>
          <span className="min-w-8 text-center text-sm font-bold tabular-nums">{row.quantity}</span>
          <button type="button" onClick={() => onChange({ quantity: Math.min(99, row.quantity + 1) })} className="p-2 text-slate-500 hover:text-primary-700" aria-label={t("increaseQuantity")}><Plus className="h-3.5 w-3.5" /></button>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-400">{t("packageTotal")}</div>
          <div className="font-black tabular-nums text-primary-700">{money.format(total)}</div>
        </div>
      </div>
    </div>
  );
}

function QuoteSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: CameraQuoteProductOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="font-semibold text-slate-500">{label}</span>
      <div className="min-w-0 [&>div]:block [&>div]:w-full">
        <Select
          size="sm"
          className="h-9 w-full text-xs"
          options={options.map((option) => ({
            value: option.id,
            label: `${option.name} · ${money.format(option.retailPrice)}`,
          }))}
          value={value}
          onValueChange={onChange}
        />
      </div>
    </div>
  );
}

function packageTotal(
  row: PackageRow,
  productById: Map<string, CameraQuoteProductOption>,
) {
  const baseTotal = [row.cameraId, row.cardId, row.installationId]
    .reduce((sum, id) => sum + (productById.get(id)?.retailPrice ?? 0), 0);
  const materialTotal = row.materialLines.reduce(
    (sum, line) => sum + (productById.get(line.productId)?.retailPrice ?? 0) * line.quantity,
    0,
  );
  return (baseTotal + materialTotal) * row.quantity;
}
