"use client";

import { useEffect, useState } from "react";

/**
 * Height of the iOS software keyboard over the layout viewport (0 when closed).
 * Safari keeps `position: fixed` bars on the layout viewport, so bars that must
 * sit on the keyboard (like SwiftUI's safeAreaInset) offset themselves by this.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
      // Ignore browser chrome shifts; only a substantial loss is the keyboard.
      setInset(covered >= 100 ? covered : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
