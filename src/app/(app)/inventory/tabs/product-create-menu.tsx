"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ChevronDown,
  PackagePlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ProductKind = "product" | "service" | "combo";

const icons: Record<ProductKind, LucideIcon> = {
  product: PackagePlus,
  service: Wrench,
  combo: Boxes,
};

export function ProductCreateMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{
    kind: ProductKind;
    label: string;
    hint: string;
    href: string;
  }>;
}) {
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
    <div ref={rootRef} className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 w-auto shrink-0 sm:static sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex h-12 w-12 items-center justify-center gap-2 rounded-2xl bg-primary-600 p-0 text-sm font-medium text-white shadow-e2 transition hover:brightness-110 active:scale-[0.98] lg:h-auto lg:min-h-0 lg:w-auto lg:rounded-full lg:px-4 lg:py-2 lg:shadow-none"
      >
        <PackagePlus className="h-4 w-4" />
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 transition-transform lg:block",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-e2 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 sm:w-80">
          {items.map((item) => {
            const Icon = icons[item.kind];
            return (
              <button
                key={item.kind}
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(item.href, { scroll: false });
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
