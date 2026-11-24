"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const PHONE_QUERY = "(max-width: 1023.98px)";

/**
 * SwiftUI `.minimumScaleFactor` for phone layouts: when the text overflows its
 * box (one line with `truncate`, or `line-clamp-N`), the font shrinks down to
 * `minScale` of its size before it is cut. Desktop keeps the original size.
 * Line clamping or truncation stays on the caller's classes.
 */
export function FitText({
  children,
  className,
  minScale = 0.72,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** Smallest size as a fraction of the CSS font size (iOS product names use 0.72). */
  minScale?: number;
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") return;
    const phone = window.matchMedia(PHONE_QUERY);

    const reset = () => {
      element.style.fontSize = "";
      element.style.lineHeight = "";
    };
    // scrollWidth is rounded to whole pixels, so text a fraction too wide would
    // still get an ellipsis; measure the text itself for one-line boxes.
    const range = document.createRange();
    const overflows = () => {
      const style = window.getComputedStyle(element);
      // Multi-line clamp: a hidden extra line. Diacritics above or below a line
      // (Vietnamese "Ô", "ặ") can add a few pixels, so less than half a line is not an overflow.
      if (style.getPropertyValue("-webkit-line-clamp") !== "none") {
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        if (element.scrollHeight - element.clientHeight > line / 2) return true;
      }
      range.selectNodeContents(element);
      const box = element.getBoundingClientRect();
      const inner = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return range.getBoundingClientRect().width > inner + 0.01;
    };

    const fit = () => {
      reset();
      if (!phone.matches || !overflows()) return;
      const style = window.getComputedStyle(element);
      const baseSize = parseFloat(style.fontSize);
      const baseLine = style.lineHeight.endsWith("px") ? parseFloat(style.lineHeight) : null;
      const apply = (scale: number) => {
        element.style.fontSize = `${baseSize * scale}px`;
        if (baseLine) element.style.lineHeight = `${baseLine * scale}px`;
      };
      apply(minScale);
      if (overflows()) return; // Still too long at the smallest size: truncate there.
      let low = minScale;
      let high = 1;
      for (let step = 0; step < 6; step += 1) {
        const middle = (low + high) / 2;
        apply(middle);
        if (overflows()) high = middle;
        else low = middle;
      }
      apply(low);
    };

    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a width change can change the fit; ignore the height changes fit() causes.
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer.observe(element);
    phone.addEventListener("change", fit);
    return () => {
      observer.disconnect();
      phone.removeEventListener("change", fit);
      reset();
    };
  }, [children, minScale]);

  return <span ref={ref} className={className} title={title}>{children}</span>;
}
