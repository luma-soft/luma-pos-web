"use client";

import type { ButtonHTMLAttributes } from "react";

export function DirectPrintButton({
  href,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { href: string }) {
  const print = () => {
    const url = new URL(href, window.location.origin);
    url.searchParams.set("embedded", "1");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.className = "fixed h-px w-px opacity-0 pointer-events-none";
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.type !== "luma-print-ready") return;
      window.removeEventListener("message", onMessage);
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      frameWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
      frameWindow.print();
    };
    window.addEventListener("message", onMessage);
    frame.src = url.toString();
    document.body.appendChild(frame);
  };

  return <button type="button" {...props} onClick={print}>{children}</button>;
}
