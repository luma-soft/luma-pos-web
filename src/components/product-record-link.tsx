import Link from "next/link";
import type { ReactNode } from "react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * Links a document line to its product. Deleted (or missing) products render
 * as plain, non-interactive text so they cannot be opened.
 */
export function ProductRecordLink({
  productId,
  deleted = false,
  className,
  linkClassName,
  newTab = false,
  children,
}: {
  productId: string | null | undefined;
  deleted?: boolean;
  /** Layout classes shared by the link and the plain fallback. */
  className?: string;
  /** Link-only styling (accent color, hover, pressed state). */
  linkClassName?: string;
  newTab?: boolean;
  children: ReactNode;
}) {
  if (!productId || deleted) {
    return <div className={className}>{children}</div>;
  }
  return (
    <Link
      href={Routes.productDetail(productId)}
      className={cn(className, linkClassName)}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </Link>
  );
}
