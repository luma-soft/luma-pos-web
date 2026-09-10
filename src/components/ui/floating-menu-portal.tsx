"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  positionFloatingMenu,
  type FloatingMenuSide,
} from "@/lib/floating-menu-position";

type FloatingMenuPortalProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "style"
> & {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef?: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  side?: FloatingMenuSide;
  gap?: number;
  matchAnchorWidth?: boolean;
  maxMenuHeight?: number;
};

export function FloatingMenuPortal({
  open,
  anchorRef,
  surfaceRef,
  onDismiss,
  side = "auto",
  gap = 8,
  matchAnchorWidth = false,
  maxMenuHeight,
  className,
  children,
  ...props
}: FloatingMenuPortalProps) {
  const ownSurfaceRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
    width?: number;
  } | null>(null);

  const setSurfaceRef = useCallback((element: HTMLDivElement | null) => {
    ownSurfaceRef.current = element;
    if (surfaceRef) surfaceRef.current = element;
  }, [surfaceRef]);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const surface = ownSurfaceRef.current;
    if (!anchor || !surface || typeof window === "undefined") return;
    const width = matchAnchorWidth
      ? anchor.width
      : surface.getBoundingClientRect().width;
    const next = positionFloatingMenu({
        trigger: anchor,
        menu: { width, height: surface.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preferredSide: side,
        gap,
      });
    setPosition({
      ...next,
      maxHeight: Math.min(next.maxHeight, maxMenuHeight ?? Number.POSITIVE_INFINITY),
      ...(matchAnchorWidth ? { width } : {}),
    });
  }, [anchorRef, gap, matchAnchorWidth, maxMenuHeight, side]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !anchorRef.current?.contains(target) &&
        !ownSurfaceRef.current?.contains(target)
      ) {
        dismissRef.current();
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismissRef.current();
      anchorRef.current?.focus({ preventScroll: true });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (ownSurfaceRef.current) observer?.observe(ownSurfaceRef.current);
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open, updatePosition]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...props}
      ref={setSurfaceRef}
      style={position
        ? {
            position: "fixed",
            left: position.left,
            top: position.top,
            maxHeight: position.maxHeight,
            ...(position.width !== undefined ? { width: position.width } : {}),
          }
        : {
            position: "fixed",
            left: 0,
            top: 0,
            visibility: "hidden",
          }}
      className={`z-[120] overflow-y-auto ${className ?? ""}`}
    >
      {children}
    </div>,
    document.body,
  );
}
