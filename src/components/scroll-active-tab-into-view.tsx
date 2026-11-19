"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the selected tab of a horizontally scrolling tab strip visible, like a
 * native segmented tab bar: on load the strip scrolls so the `aria-current`
 * item sits near the centre. Only the strip scrolls, never the page.
 */
export function ScrollActiveTabIntoView({ activeKey }: { activeKey: string }) {
  const markerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const strip = markerRef.current?.parentElement;
    let scroller: HTMLElement | null | undefined = strip;
    while (scroller && scroller.scrollWidth <= scroller.clientWidth) scroller = scroller.parentElement;
    const active = strip?.querySelector<HTMLElement>("[aria-current='page']");
    if (!scroller || !active) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const target = scroller.scrollLeft + activeBox.left - scrollerBox.left - (scrollerBox.width - activeBox.width) / 2;
    scroller.scrollLeft = Math.max(0, target);
  }, [activeKey]);
  return <span ref={markerRef} hidden />;
}
