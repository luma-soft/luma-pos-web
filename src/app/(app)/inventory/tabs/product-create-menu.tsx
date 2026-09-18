"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  PackagePlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type ProductKind = "product" | "service" | "combo";

type ProductCreateMenuItem = {
  kind: ProductKind;
  label: string;
  hint: string;
  href?: string;
};

const icons: Record<ProductKind, LucideIcon> = {
  product: PackagePlus,
  service: Wrench,
  combo: Boxes,
};

export function ProductCreateMenu({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: ProductCreateMenuItem[];
  onSelect?: (kind: ProductKind) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 w-auto shrink-0 sm:relative sm:bottom-auto sm:right-auto sm:ml-auto sm:w-auto">
      <Button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "product-create-menu" : undefined}
        className="h-12 w-auto rounded-lg px-4 shadow-e2 active:scale-[0.98] lg:h-10 lg:px-4 lg:shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
      >
        <PackagePlus className="h-4 w-4" />
        <span>{label}</span>
      </Button>
      {open && (
        <div id="product-create-menu" role="menu" className="absolute bottom-full right-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-e2 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 sm:w-80">
          {items.map((item) => {
            const Icon = icons[item.kind];
            return (
              <button
                key={item.kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (onSelect) {
                    onSelect(item.kind);
                  } else if (item.href) {
                    router.push(item.href, { scroll: false });
                  }
                }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
              >
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
