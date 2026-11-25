"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DetailCloseContext, MobileDetailNav } from "@/components/mobile-detail-nav";
import { cn } from "@/lib/utils";
import { useHideMobileTabBar } from "@/components/mobile-tabbar-visibility";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/**
 * A screen pushed onto the phone navigation stack (SwiftUI navigationDestination):
 * covers the page and the tab bar, shows the iOS detail bar (back, centred title,
 * "…" actions) and scrolls its own content on the grouped background.
 * Phones only; callers render their desktop UI separately.
 */
export function MobilePushedScreen({
  title,
  actions,
  onBack,
  children,
  className,
  layer = 0,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  children: ReactNode;
  className?: string;
  /** Nesting depth, so a screen pushed from a pushed screen stacks above it. */
  layer?: number;
}) {
  useHideMobileTabBar();
  const layerSurfaceRef = useRef<HTMLDivElement>(null);
  useModalLayer({ onEscape: onBack, elementRef: layerSurfaceRef });

  return createPortal(
    <DetailCloseContext.Provider value={onBack}>
      <div ref={layerSurfaceRef}
        role="dialog"
        aria-modal="true"
        className={cn("fixed inset-0 flex flex-col overflow-y-auto overscroll-contain bg-canvas lg:hidden", className)}
        style={{ zIndex: 95 + layer }}
      >
        <MobileDetailNav title={title} actions={actions} />
        <div className="flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </DetailCloseContext.Provider>,
    document.body,
  );
}

/** iOS inset-grouped section: optional grey header and a rounded card of rows. */
export function MobileGroupedSection({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title != null && <h3 className="px-4 text-[15px] font-semibold leading-5 text-ios-label-secondary">{title}</h3>}
      <div className="overflow-hidden rounded-[26px] bg-surface [&>*+*]:bg-[linear-gradient(var(--color-border),var(--color-border))] [&>*+*]:bg-[length:calc(100%-16px)_1px] [&>*+*]:bg-right-top [&>*+*]:bg-no-repeat">
        {children}
      </div>
    </section>
  );
}
