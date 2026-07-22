"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  materialId: string;
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
    materialId: options.materials[index].id,
  };
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function CameraQuoteBuilder({ options }: { options: CameraQuoteFormOptions }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [projectName, setProjectName] = useState("Báo giá lắp đặt camera");
  const [note, setNote] = useState(
    "Thẻ nhớ chính hãng chuyên dụng, bảo hành 24 tháng. Giá đã gồm công lắp đặt, cấu hình ứng dụng và vật tư cơ bản theo từng gói. Chi phí phát sinh chỉ thực hiện sau khi khách hàng đồng ý.",
  );
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
        materialId: defaults.materialId,
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
      setError("Hãy thêm ít nhất một camera vào báo giá.");
      return;
    }
    if (!options.defaultWarehouseId) {
      setError("Chưa có kho mặc định để lưu báo giá.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const items = packages.flatMap((row) => {
        const selected = [
          productById.get(row.cameraId),
          productById.get(row.cardId),
          productById.get(row.installationId),
          productById.get(row.materialId),
        ];
        return selected.flatMap((product) =>
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
      });

      const result = await createOrder({
        mode: "quote",
        clientId: crypto.randomUUID(),
        customerId: customerId || null,
        warehouseId: options.defaultWarehouseId!,
        projectName: projectName.trim() || "Báo giá lắp đặt camera",
        note: note.trim(),
        discount: 0,
        taxRate: 0,
        shippingFee: 0,
        items,
        payment: { method: "credit", amount: 0 },
      });

      if (!result.ok) {
        setError("Không thể lưu báo giá. Vui lòng kiểm tra quyền bán hàng và dữ liệu sản phẩm.");
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
              <span>Khách hàng</span>
              <div className="[&>div]:block [&>div]:w-full">
                <Select
                  className="w-full"
                  options={[
                    { value: "", label: "Khách lẻ / chưa chọn" },
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
              <span>Tên công trình / nội dung</span>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              />
            </label>
          </div>
          <label className="mt-4 block space-y-1.5 text-sm font-medium">
            <span>Ghi chú báo giá</span>
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
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Chọn camera</h2>
              <p className="mt-1 text-sm text-slate-500">Giá dưới đây là giá riêng của camera, chưa gồm thẻ, công và vật tư.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm tên hoặc mã camera"
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
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Các gói trong báo giá</h2>
                <p className="mt-0.5 text-xs text-slate-500">{cameraCount} camera · {packages.length} cấu hình</p>
              </div>
              <FileText className="h-5 w-5 text-primary-600" />
            </div>

            {packages.length === 0 ? (
              <div className="px-6 py-14 text-center text-slate-400">
                <Camera className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="font-medium">Chưa chọn camera</p>
                <p className="mt-1 text-sm">Bấm “Thêm vào báo giá” ở danh sách bên trái.</p>
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
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tổng báo giá</div>
                  <div className="mt-1 text-2xl font-black tabular-nums text-primary-700">{money.format(quoteTotal)}</div>
                </div>
                <div className="text-right text-xs text-slate-500">Chưa gồm chi phí<br />phát sinh thực tế</div>
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
                  {isPending ? "Đang lưu…" : "Lưu báo giá"}
                </button>
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={isPending || packages.length === 0}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  Lưu & in
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
        <Plus className="h-4 w-4" /> Thêm vào báo giá
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
  const camera = productById.get(row.cameraId)!;
  const total = packageTotal(row, productById);
  return (
    <div className="rounded-xl border border-border-soft bg-canvas/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-primary-600">Gói {String(index + 1).padStart(2, "0")}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-bold">{camera.name}</div>
          <div className="mt-1 text-xs text-slate-400">{camera.sku}</div>
        </div>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Xóa gói">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        <QuoteSelect label="Thẻ nhớ" value={row.cardId} options={options.cards} onChange={(cardId) => onChange({ cardId })} />
        <QuoteSelect label="Công lắp" value={row.installationId} options={options.installations} onChange={(installationId) => onChange({ installationId })} />
        <QuoteSelect label="Vật tư" value={row.materialId} options={options.materials} onChange={(materialId) => onChange({ materialId })} />
      </div>

      <details className="mt-3 rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-600">Xem bảng thông số camera</summary>
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
          <button type="button" onClick={() => onChange({ quantity: Math.max(1, row.quantity - 1) })} className="p-2 text-slate-500 hover:text-primary-700" aria-label="Giảm số lượng"><Minus className="h-3.5 w-3.5" /></button>
          <span className="min-w-8 text-center text-sm font-bold tabular-nums">{row.quantity}</span>
          <button type="button" onClick={() => onChange({ quantity: Math.min(99, row.quantity + 1) })} className="p-2 text-slate-500 hover:text-primary-700" aria-label="Tăng số lượng"><Plus className="h-3.5 w-3.5" /></button>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-400">Trọn gói</div>
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
  return [row.cameraId, row.cardId, row.installationId, row.materialId]
    .reduce((sum, id) => sum + (productById.get(id)?.retailPrice ?? 0), 0) * row.quantity;
}
