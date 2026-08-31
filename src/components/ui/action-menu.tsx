"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type LumaActionMenuItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  onSelect: () => void;
};

export function LumaActionMenu({
  label,
  ariaLabel,
  icon: TriggerIcon,
  iconOnly = false,
  items,
  side = "bottom",
  className,
}: {
  label: string;
  ariaLabel?: string;
  icon?: LucideIcon;
  iconOnly?: boolean;
  items: LumaActionMenuItem[];
  side?: "top" | "bottom";
  className?: string;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  function focusItem(direction: 1 | -1) {
    const enabled = itemRefs.current.filter(
      (item): item is HTMLButtonElement => Boolean(item && !item.disabled),
    );
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(current + direction + enabled.length) % enabled.length]?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => focusItem(1));
        }}
        className={`${className ?? ""} min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11 lg:min-h-0 lg:min-w-0`}
      >
        {TriggerIcon && <TriggerIcon className="h-4 w-4" />}
        {iconOnly ? <span className="sr-only">{label}</span> : label}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusItem(event.key === "ArrowDown" ? 1 : -1);
            }
          }}
          className={cn(
            "absolute right-0 z-50 w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-e2",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
