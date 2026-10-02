"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { MouseEventHandler, ReactNode } from "react";

export function PurchaseDetailLink({
  purchaseId,
  children,
  className,
  ariaLabel,
  onClick,
}: {
  purchaseId: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const next = new URLSearchParams(searchParams.toString());
  next.set("detailPurchaseId", purchaseId);

  return (
    <Link
      href={`${pathname}?${next.toString()}`}
      replace
      scroll={false}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
