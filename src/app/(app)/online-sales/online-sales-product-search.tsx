"use client";

import Link from "next/link";
import { Store } from "lucide-react";
import { Routes } from "@/lib/routes";

export function OnlineSalesListingButton({ L }: { L: boolean }) {
  return (
    <Link
      href={`${Routes.OnlineSales}?onlineListing=1`}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
    >
      <Store className="h-4 w-4" />
      {L ? "Đăng bán" : "List product"}
    </Link>
  );
}
