"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Printer } from "lucide-react";
import { FloatingMenuPortal } from "@/components/ui/floating-menu-portal";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { cn } from "@/lib/utils";

export function PrintTemplateMenu({
  baseHref,
  templates = [],
  label,
  className,
}: {
  baseHref: string;
  templates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[];
  label: string;
  className?: string;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const customTemplates = templates.filter((template) => !template.name.toLocaleLowerCase("vi").includes("mặc định"));
  const menuTemplates = customTemplates.length > 0
    ? customTemplates
    : (["a4", "a5", "k80"] as const).map((size) => ({
        id: templates[0]?.id ?? "default-order",
        name: `Mẫu ${size.toUpperCase()}`,
        paperDefault: size,
      }));

  const print = (template: Pick<PrintTemplate, "id" | "paperDefault">) => {
    const url = new URL(baseHref, window.location.origin);
    url.searchParams.set("templateId", template.id);
    url.searchParams.set("size", template.paperDefault);
    url.searchParams.set("embedded", "1");
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
    frame.src = url.toString();
    document.body.appendChild(frame);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)} className={cn("inline-flex items-center gap-1.5 min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11 lg:min-h-0 lg:min-w-0", className)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}>
        <Printer className="h-4 w-4" />
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <FloatingMenuPortal
        open={open}
        anchorRef={triggerRef}
        onDismiss={() => setOpen(false)}
        side="top"
        id={menuId}
        role="menu"
        className="min-w-52 rounded-lg border border-border bg-surface py-1 shadow-e2"
      >
          {menuTemplates.map((template) => (
            <button key={`${template.id}-${template.paperDefault}`} type="button" role="menuitem" onClick={() => print(template)} className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm font-medium hover:bg-surface-2">
              {template.name}
            </button>
          ))}
      </FloatingMenuPortal>
    </div>
  );
}
