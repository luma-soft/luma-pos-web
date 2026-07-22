"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CameraPickerModal, type CameraPickerProduct } from "@/components/pos/camera-picker-modal";
import { cn } from "@/lib/utils";

export function CameraQuoteCreateButton({ cameras, className }: { cameras: CameraPickerProduct[]; className?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]", className)}>
        {t("quotes.createQuote")}
      </button>
      <CameraPickerModal
        open={open}
        cameras={cameras}
        onClose={() => setOpen(false)}
        onSelect={(camera) => router.push(`/pos?cameraQuote=1&cameraId=${encodeURIComponent(camera.id)}`)}
      />
    </>
  );
}
