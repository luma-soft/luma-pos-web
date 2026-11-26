"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useDetailReturnHref } from "@/components/use-detail-return-href";

/**
 * `Link` to a record that keeps the current page when the record's modal
 * closes (see `resolveDetailHref`).
 */
export function DetailReturnLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const target = useDetailReturnHref(href);
  return (
    <Link
      {...props}
      href={target.href}
      scroll={target.href === href ? props.scroll : false}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        target.onNavigate();
      }}
    />
  );
}
