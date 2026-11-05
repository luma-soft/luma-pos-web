"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

export function MergePrintToolbar({
  backHref,
  backLabel,
  title,
  notice,
  printLabel,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  notice: string;
  printLabel: string;
}) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 print:hidden">
      <Link href={backHref} aria-label={backLabel} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="font-semibold">{title}</h1>
        <p className="text-sm text-slate-500">{notice}</p>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
      >
        <Printer className="h-4 w-4" />
        {printLabel}
      </button>
    </header>
  );
}
