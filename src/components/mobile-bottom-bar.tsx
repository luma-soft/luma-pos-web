"use client";

import type { ReactNode } from "react";
import { useKeyboardInset } from "@/components/use-keyboard-inset";
import { cn } from "@/lib/utils";

/**
 * Phone search/filter bar pinned at the bottom of a list, above the tab bar
 * (SwiftUI `.safeAreaInset(edge: .bottom)` with LumaSearchFilterBar). While the
 * keyboard is open it rides on top of the keyboard instead. Renders a spacer so
 * the last rows are not hidden behind it. Desktop renders nothing.
 */
export function MobileBottomSearchBar({ children, className }: { children: ReactNode; className?: string }) {
  const keyboardInset = useKeyboardInset();
  return (
    <>
      <div className="h-[72px] lg:hidden" aria-hidden="true" />
      <div
        className={cn(
          "fixed inset-x-0 z-30 border-t border-border bg-surface px-ios-inset py-2 lg:hidden",
          keyboardInset === 0 && "bottom-(--mobile-tabbar-space)",
          className,
        )}
        style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
      >
        {children}
      </div>
    </>
  );
}
