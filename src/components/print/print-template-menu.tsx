"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Printer } from "lucide-react";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { cn } from "@/lib/utils";

export function PrintTemplateMenu({
  baseHref,
  templates,
  label,
  className,
}: {
  baseHref: string;
  templates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const print = (template: Pick<PrintTemplate, "id">, size: PrintTemplate["paperDefault"]) => {
    const params = new URLSearchParams({ templateId: template.id, size, autoclose: "1" });
    window.open(`${baseHref}?${params.toString()}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className={cn("inline-flex items-center gap-1.5", className)} aria-expanded={open}>
        <Printer className="h-4 w-4" />
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-[80] mb-2 min-w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-e2">
          {templates.flatMap((template) => (["a4", "a5", "k80"] as const).map((size) => (
            <button key={`${template.id}-${size}`} type="button" onClick={() => print(template, size)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
              <span className="font-medium">{template.name}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-bold uppercase text-slate-500">{size}</span>
            </button>
          )))}
        </div>
      )}
    </div>
  );
}
