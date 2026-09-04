"use client";

import Link from "next/link";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export function PartnerDetailLink({
  kind,
  partnerId,
  name,
  className,
}: {
  kind: "customer" | "supplier";
  partnerId?: string | null;
  name: string;
  className?: string;
}) {
  if (!partnerId) return <>{name}</>;

  return (
    <Link
      href={kind === "customer" ? Routes.customerDetail(partnerId) : Routes.supplierDetail(partnerId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center rounded-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:min-h-0 lg:min-w-0",
        className,
      )}
    >
      {name}
    </Link>
  );
}
