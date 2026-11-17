"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  PackagePlus,
  Plus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { controlHeightClassName } from "@/components/ui/button-variants";

export type ProductKind = "product" | "service" | "combo";

type ProductCreateMenuItem = {
  kind: ProductKind;
  label: string;
  hint: string;
  href?: string;
};

type ProductCreateMenuAction = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  onSelect: () => void;
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
  showLabel = true,
  additionalActions = [],
  nativeMobile = false,
  nativeMobileIcon = "plus",
}: {
  label: string;
  items: ProductCreateMenuItem[];
  onSelect?: (kind: ProductKind) => void;
  showLabel?: boolean;
  additionalActions?: ProductCreateMenuAction[];
  /** Phones: inline iOS "+" square beside search/filter instead of a floating button. */
  nativeMobile?: boolean;
  /** Use the package glyph where a "+" would be confused with another create action. */
  nativeMobileIcon?: "plus" | "package";
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
    <div ref={rootRef} className={nativeMobile
      ? "relative z-30 w-auto shrink-0 lg:ml-auto"
      : "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30 w-auto shrink-0 sm:relative sm:bottom-auto sm:right-auto sm:ml-auto sm:w-auto"}>
      <Button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "product-create-menu" : undefined}
        className={cn(
          "rounded-lg shadow-e2 active:scale-[0.98] lg:shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
          showLabel
            ? `${controlHeightClassName} w-auto px-4`
            : `${controlHeightClassName} w-11 px-0 lg:w-10`,
          nativeMobile && "max-lg:size-12 max-lg:rounded-2xl max-lg:border max-lg:border-ios-stroke/60 max-lg:bg-surface max-lg:px-0 max-lg:text-ios-accent max-lg:shadow-none",
        )}
      >
        <PackagePlus className={cn("h-4 w-4", nativeMobile && nativeMobileIcon === "plus" && "max-lg:hidden", nativeMobile && nativeMobileIcon === "package" && "max-lg:!size-[22px]")} />
        {nativeMobile && nativeMobileIcon === "plus" && <Plus className="!size-6 lg:hidden" strokeWidth={2.2} aria-hidden="true" />}
        {showLabel && <span className={cn(nativeMobile && "max-lg:sr-only")}>{label}</span>}
      </Button>
      {open && (
        <div id="product-create-menu" role="menu" className={cn("absolute right-0 z-50 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-e2 sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 sm:w-80", nativeMobile ? "top-full mt-2" : "bottom-full mb-2")}>
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
          {additionalActions.length > 0 && (
            <>
              <div role="separator" className="my-1 border-t border-border" />
              {additionalActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      action.onSelect();
                    }}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
                  >
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">
                        {action.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {action.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
