"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useModalClose } from "@/components/use-modal-close";

/**
 * Close control for a route-backed modal: returns to the page that opened it
 * (keeping its filters and scroll), else to `href`. Modified clicks keep the
 * plain link behaviour.
 */
export function ModalCloseLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const close = useModalClose(href);
  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        close();
      }}
    />
  );
}
