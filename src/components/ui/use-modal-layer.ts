"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { lockBodyScroll, pushModalLayer, type ModalLayerHandle } from "@/lib/modal-layer";

/**
 * Register an open modal, drawer or sheet in the app-wide layer stack.
 * Escape calls `onEscape` only while this layer is on top; `lockScroll`
 * keeps the page from scrolling until every locking layer has closed.
 *
 * Pass the `aria-modal` surface as `elementRef` so Escape can tell this
 * layer apart from modals that are not registered. Returns `isTop()` for
 * focus traps that must act only on the top layer.
 */
export function useModalLayer({
  open = true,
  onEscape,
  lockScroll = false,
  elementRef,
}: {
  open?: boolean;
  onEscape?: () => void;
  lockScroll?: boolean;
  elementRef?: RefObject<Element | null>;
}) {
  const handleRef = useRef<ModalLayerHandle | null>(null);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const handle = pushModalLayer({
      lockScroll,
      onEscape: () => onEscapeRef.current?.(),
      getElement: () => elementRef?.current ?? null,
    });
    handleRef.current = handle;
    return () => {
      handle.release();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [open, lockScroll, elementRef]);

  return useMemo(() => ({
    isTop: () => handleRef.current?.isTop() ?? false,
  }), []);
}

/** Lock page scroll while `active`, shared safely with every other lock. */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
