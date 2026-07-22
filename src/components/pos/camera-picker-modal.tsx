"use client";

import Image from "next/image";
import { Camera, Search, X } from "lucide-react";
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
};

type Props = {
  open: boolean;
  cameras: CameraPickerProduct[];
  onClose: () => void;
  onSelect: (camera: CameraPickerProduct) => void;
};

export function CameraPickerModal({ open, cameras, onClose, onSelect }: Props) {
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    if (!query) return cameras;
    return cameras.filter((camera) => `${camera.name} ${camera.sku} ${camera.description ?? ""}`.toLocaleLowerCase("vi").includes(query));
  }, [cameras, search]);

  if (!open) return null;

  function close() {
    setSearch("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4" role="presentation" onMouseDown={close}>
      <div className="flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label={t("pos.cameraQuote.pickerTitle")} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-bold sm:text-lg">{t("pos.cameraQuote.pickerTitle")}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{t("pos.cameraQuote.pickerDescription")}</p>
          </div>
          <Button type="button" variant="ghost" size="iconSm" aria-label={t("common.close")} onClick={close}><X className="h-5 w-5" /></Button>
        </div>
        <div className="border-b border-border p-4 sm:px-5">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("pos.cameraQuote.pickerSearch")} leftIcon={<Search />} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {filtered.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-sm text-slate-500">{t("pos.cameraQuote.pickerEmpty")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((camera) => (
                <button key={camera.id} type="button" onClick={() => { onSelect(camera); close(); }} className="group overflow-hidden rounded-xl border border-border-soft bg-canvas/50 text-left transition hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <div className="flex h-36 items-center justify-center bg-white p-3 dark:bg-slate-950">
                    {camera.imageUrl ? <Image src={camera.imageUrl} alt={camera.name} width={220} height={140} unoptimized className="h-full w-full object-contain" /> : <Camera className="h-12 w-12 text-slate-300" />}
                  </div>
                  <div className="p-3">
                    <div className="line-clamp-2 text-sm font-bold text-slate-900 dark:text-slate-100">{camera.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{camera.sku}</div>
                    <div className="mt-2 font-black tabular-nums text-primary-700">{formatCurrency(camera.retailPrice)}</div>
                    <div className="mt-2 text-xs font-semibold text-primary-600 group-hover:underline">{t("pos.cameraQuote.chooseCamera")}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
