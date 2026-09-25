"use client";
import { legacyTextByFlag } from "@/lib/i18n/catalog-text";

import Link from "next/link";
import { Store } from "lucide-react";
import { Routes } from "@/lib/routes";

export function OnlineSalesListingButton({ L, tab = "listings" }: { L: boolean; tab?: string }) {
  const params = new URLSearchParams({ tab, onlineListing: "1" });
  return (
    <Link
      href={`${Routes.OnlineSales}?${params.toString()}`}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110"
    >
      <Store className="h-4 w-4" />
      {legacyTextByFlag(L, "43e94e107c8f")}
    </Link>
  );
}
