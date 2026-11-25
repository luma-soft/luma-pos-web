"use client";

import { useRef, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/**
 * Modal surface for server-rendered pages: registers the surface in the
 * app-wide modal layer stack, and on Escape navigates to `closeHref`.
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
  const router = useRouter();
  const surfaceRef = useRef<HTMLElement>(null);
  useModalLayer({
    onEscape: closeHref ? () => router.push(closeHref) : undefined,
    lockScroll,
    elementRef: surfaceRef,
  });
  return <Tag ref={surfaceRef as never} {...props} />;
}
