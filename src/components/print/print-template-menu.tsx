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

  const print = (template: Pick<PrintTemplate, "id" | "paperDefault">) => {
    const params = new URLSearchParams({ templateId: template.id, size: template.paperDefault, embedded: "1" });
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.className = "fixed h-px w-px opacity-0 pointer-events-none";
    const printFrame = () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      const remove = () => frame.remove();
      frameWindow.addEventListener("afterprint", remove, { once: true });
      frameWindow.print();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.type !== "luma-print-ready") return;
      window.removeEventListener("message", onMessage);
      printFrame();
    };
    window.addEventListener("message", onMessage);
    frame.src = `${baseHref}?${params.toString()}`;
    document.body.appendChild(frame);
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
        <div className="absolute bottom-full right-0 z-[80] mb-2 min-w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-e2">
          {templates.some((template) => !template.id.startsWith("default-"))
            ? templates.filter((template) => !template.id.startsWith("default-")).map((template) => (
                <button key={template.id} type="button" onClick={() => print(template)} className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm font-medium hover:bg-surface-2">
                  {template.name}
                </button>
              ))
            : (["a4", "a5", "k80"] as const).map((size) => (
                <button key={size} type="button" onClick={() => print({ id: templates[0]?.id ?? "default-order", paperDefault: size })} className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm font-medium hover:bg-surface-2">
                  Mẫu {size.toUpperCase()}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
