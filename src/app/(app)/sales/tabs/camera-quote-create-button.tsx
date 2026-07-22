"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function CameraQuoteCreateButton({ className }: { className?: string }) {
  const t = useTranslations();
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.push("/pos?cameraQuote=1")} className={cn("inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]", className)}>
      {t("quotes.createQuote")}
    </button>
  );
}
