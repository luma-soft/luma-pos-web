"use client";

import { useRef } from "react";

/**
 * Native-style long press for list rows: after 500ms the callback runs and the
 * click that ends the press is swallowed, so the row does not also open.
 */
export function useLongPress(onLongPress?: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  if (!onLongPress) {
    return { handlers: {}, consumeClick: () => false };
  }
  return {
    handlers: {
      onPointerDown: () => {
        fired.current = false;
        cancel();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(10);
          onLongPress();
        }, 500);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
    /** True when the click ends a long press and must not run the row action. */
    consumeClick: () => {
      if (!fired.current) return false;
      fired.current = false;
      return true;
    },
  };
}
