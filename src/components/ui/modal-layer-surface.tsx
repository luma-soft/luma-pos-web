"use client";

import { useRef, type HTMLAttributes } from "react";
import { useModalClose } from "@/components/use-modal-close";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/**
 * Modal surface for server-rendered pages: registers the surface in the
 * app-wide modal layer stack, and on Escape closes back to the page that
 * opened it (or `closeHref` with its remembered list filters).
 */
export function ModalLayerSurface({
  as: Tag = "section",
  closeHref,
  lockScroll = false,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "aside";
  closeHref?: string;
  lockScroll?: boolean;
}) {
  const close = useModalClose(closeHref ?? "/");
  const surfaceRef = useRef<HTMLElement>(null);
  useModalLayer({
    onEscape: closeHref ? close : undefined,
    lockScroll,
    elementRef: surfaceRef,
  });
  return <Tag ref={surfaceRef as never} {...props} />;
}
