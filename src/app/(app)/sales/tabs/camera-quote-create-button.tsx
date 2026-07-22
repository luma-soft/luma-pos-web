"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, ChevronDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CameraQuoteCreateButton({ className }: { className?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button type="button" size="sm" onClick={() => setOpen((value) => !value)}>
        {t("quotes.createQuote")} <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-e2">
          <button type="button" onClick={() => { setOpen(false); router.push("/pos?draft=quote"); }} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2">
            <FileText className="mt-0.5 h-4 w-4 text-primary-600" />
            <span><span className="block text-sm font-semibold">{t("quotes.createQuoteNormal")}</span><span className="mt-0.5 block text-xs text-slate-500">{t("quotes.createQuoteNormalHint")}</span></span>
          </button>
          <button type="button" onClick={() => { setOpen(false); router.push("/pos?cameraQuote=1"); }} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2">
            <Camera className="mt-0.5 h-4 w-4 text-primary-600" />
            <span><span className="block text-sm font-semibold">{t("quotes.createQuoteCamera")}</span><span className="mt-0.5 block text-xs text-slate-500">{t("quotes.createQuoteCameraHint")}</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
