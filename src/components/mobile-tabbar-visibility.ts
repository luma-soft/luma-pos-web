"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Screens that cover the page on phones (pushed details, full-screen forms) ask the
 * floating tab bar to slide away while they are open, like a pushed SwiftUI screen
 * with the tab bar hidden. A counter so nested screens keep it hidden until the last
 * one closes.
 */
let hideRequests = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileTabBarHideRequested() {
  return useSyncExternalStore(subscribe, () => hideRequests > 0, () => false);
}

/** Hides the phone tab bar while the calling component is mounted (and `active`). */
export function useHideMobileTabBar(active = true) {
  useEffect(() => {
    if (!active) return;
    hideRequests += 1;
    emit();
    return () => {
      hideRequests -= 1;
      emit();
    };
  }, [active]);
}
