"use client";

import { useEffect } from "react";

/**
 * Safari tints its status bar / top chrome from the page: iOS 26 follows the
 * `<body>` background (it ignores runtime theme-color changes), older Safari and
 * desktop follow `<meta name="theme-color">`. A single static value can't match
 * every page: grouped screens use the grey canvas, list screens use white
 * surfaces. This samples the opaque background at the top edge of the viewport
 * and mirrors it into theme-color + the html/body background, so the chrome
 * always blends with the visible header.
 */

function parseRgb(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function toHex([r, g, b]: [number, number, number, number]) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
}

function sampleTopColor(): string | null {
  let el: Element | null = document.elementFromPoint(window.innerWidth / 2, 1);
  while (el && el !== document.documentElement) {
    const rgba = parseRgb(getComputedStyle(el).backgroundColor);
    // Skip transparent layers; translucent blurred bars (e.g. bg-canvas/85) still count.
    if (rgba && rgba[3] >= 0.5) return toHex(rgba);
    el = el.parentElement;
  }
  const body = parseRgb(getComputedStyle(document.body).backgroundColor);
  return body && body[3] > 0 ? toHex(body) : null;
}

export function SafariChromeColorSync() {
  useEffect(() => {
    let frame = 0;
    let last = "";

    const root = document.documentElement;
    const apply = () => {
      frame = 0;
      // Sample against the stylesheet colors, not a previous page's inline override.
      root.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      const color = sampleTopColor();
      if (color) {
        root.style.backgroundColor = color;
        document.body.style.backgroundColor = color;
      }
      if (!color || color === last) return;
      last = color;
      let metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
      if (metas.length === 0) {
        const meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
        metas = [meta];
      }
      for (const meta of metas) meta.content = color;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    observer.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      scheme.removeEventListener("change", schedule);
    };
  }, []);

  return null;
}
