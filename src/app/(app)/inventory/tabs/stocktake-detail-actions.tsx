"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy, Printer } from "lucide-react";
import { StocktakeRowActions } from "../../stocktakes/stocktake-actions";
import { Routes } from "@/lib/routes";

export function StocktakeDetailActions({ id, status, canCancelBalanced }: { id: string; status: string; canCancelBalanced: boolean }) {
  const t = useTranslations();

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <StocktakeRowActions id={id} status={status} canCancelBalanced={canCancelBalanced} prominentCancel />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Link
          href={Routes.stocktakeCopy(id)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-slate-700 transition hover:bg-surface-2 dark:text-slate-200"
        >
          <Copy className="h-4 w-4" />
          {t("stocktakes.copy")}
        </Link>
        <Link
          href={Routes.stocktakePrint(id)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-slate-700 transition hover:bg-surface-2 dark:text-slate-200"
        >
          <Printer className="h-4 w-4" />
          {t("print.printBtn")}
        </Link>
      </div>
    </div>
  );
}
