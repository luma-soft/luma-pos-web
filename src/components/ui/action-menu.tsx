"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { positionFloatingMenu } from "@/lib/floating-menu-position";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const menuElement = menuRef.current;
    if (!trigger || !menuElement || typeof window === "undefined") return;
    const menu = menuElement.getBoundingClientRect();
    setMenuPosition(
      positionFloatingMenu({
        trigger,
        menu: { width: menu.width, height: menuElement.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preferredSide: side,
        gap: 8,
      }),
    );
  }, [side]);

  useLayoutEffect(() => {
    if (open) updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

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
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          style={menuPosition
            ? {
                position: "fixed",
                left: menuPosition.left,
                top: menuPosition.top,
                maxHeight: menuPosition.maxHeight,
              }
            : {
                position: "fixed",
                left: 0,
                top: 0,
                visibility: "hidden",
              }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusItem(event.key === "ArrowDown" ? 1 : -1);
            }
          }}
          className="z-[100] w-56 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-e2"
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
        </div>,
        document.body,
      )}
    </div>
  );
}
