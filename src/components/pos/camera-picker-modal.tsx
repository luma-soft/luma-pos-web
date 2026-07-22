"use client";

import Image from "next/image";
import { Camera, HardDrive, Package, Search, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

export type CameraPickerProduct = {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  imageUrl?: string | null;
  description?: string | null;
  unitName?: string | null;
};

function formatUnit(unit?: string | null) {
  const value = unit?.trim();
  if (!value || value.toLocaleLowerCase("vi") === "điểm") return "";
  if (value.toLocaleLowerCase("vi") === "cái") return "cái";
  if (value.toLocaleLowerCase("vi") === "cuộn") return "cuộn";
  return value;
}

type Props = {
  open: boolean;
  cameras: CameraPickerProduct[];
  memoryCards: CameraPickerProduct[];
  installations: CameraPickerProduct[];
  materials: CameraPickerProduct[];
  onClose: () => void;
  onSelect: (camera: CameraPickerProduct) => void;
};

export function CameraPickerModal({ open, cameras, memoryCards, installations, materials, onClose, onSelect }: Props) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"camera" | "memory" | "installation" | "material">("camera");
  const lists = { camera: cameras, memory: memoryCards, installation: installations, material: materials };
  const activeProducts = lists[activeTab];
  const searchPlaceholder = activeTab === "camera"
    ? t("pos.cameraQuote.pickerSearchCamera")
    : activeTab === "memory"
      ? t("pos.cameraQuote.pickerSearchMemory")
      : activeTab === "installation"
        ? t("pos.cameraQuote.pickerSearchInstallation")
        : t("pos.cameraQuote.pickerSearchMaterial");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    if (!query) return activeProducts;
    return activeProducts.filter((product) => `${product.name} ${product.sku} ${product.description ?? ""}`.toLocaleLowerCase("vi").includes(query));
  }, [activeProducts, search]);

  if (!open) return null;

  function close() {
    setSearch("");
    setActiveTab("camera");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={close}>
      <div className="flex h-[min(860px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label={t("pos.cameraQuote.pickerTitle")} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-bold sm:text-lg">{t("pos.cameraQuote.pickerTitle")}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{t("pos.cameraQuote.pickerDescription")}</p>
          </div>
          <Button type="button" variant="ghost" size="iconSm" aria-label={t("common.close")} onClick={close}><X className="h-5 w-5" /></Button>
        </div>
        <div className="border-b border-border p-4 sm:px-5">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} leftIcon={<Search />} />
          <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1" role="tablist">
            {([
              ["camera", t("pos.cameraQuote.cameraTab"), cameras.length],
              ["memory", t("pos.cameraQuote.memoryTab"), memoryCards.length],
              ["installation", t("pos.cameraQuote.installationTab"), installations.length],
              ["material", t("pos.cameraQuote.materialTab"), materials.length],
            ] as const).map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => { setActiveTab(id); setSearch(""); }} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${activeTab === id ? "bg-surface text-primary-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>
                {label}<span className="text-[10px] text-slate-400">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {filtered.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-sm text-slate-500">{t("pos.cameraQuote.pickerEmpty")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((product) => activeTab === "camera" ? (
                <button key={product.id} type="button" onClick={() => { onSelect(product); close(); }} className="group overflow-hidden rounded-xl border border-border-soft bg-canvas/50 text-left transition hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <div className="flex h-36 items-center justify-center bg-white p-3 dark:bg-slate-950">
                    {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} width={220} height={140} unoptimized className="h-full w-full object-contain" /> : <Camera className="h-12 w-12 text-slate-300" />}
                  </div>
                  <div className="p-3">
                    <div className="line-clamp-2 text-sm font-bold text-slate-900 dark:text-slate-100">{product.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{product.sku}</div>
                    <div className="mt-2 font-black tabular-nums text-primary-700">{formatCurrency(product.retailPrice)}</div>
                    <div className="mt-2 text-xs font-semibold text-primary-600 group-hover:underline">{t("pos.cameraQuote.chooseCamera")}</div>
                  </div>
                </button>
              ) : (
                <div key={product.id} className="rounded-xl border border-border-soft bg-canvas/50 p-4">
                  <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">{activeTab === "memory" ? <HardDrive className="h-5 w-5" /> : activeTab === "installation" ? <Wrench className="h-5 w-5" /> : <Package className="h-5 w-5" />}</div><div className="min-w-0"><div className="line-clamp-2 text-sm font-bold text-slate-900 dark:text-slate-100">{product.name}</div><div className="mt-1 text-xs text-slate-400">{product.sku}</div></div></div>
                  <div className="mt-4 flex items-end justify-between gap-2"><span className="text-xs text-slate-500">{formatUnit(product.unitName) ? `${t("pos.cameraQuote.unitLabel")}: ${formatUnit(product.unitName)}` : ""}</span><span className="font-black tabular-nums text-primary-700">{formatCurrency(product.retailPrice)}</span></div>
                  <div className="mt-2 text-xs text-slate-500">{t("pos.cameraQuote.referenceOnly")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
