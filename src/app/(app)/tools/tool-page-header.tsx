import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Routes } from "@/lib/routes";

export function ToolPageHeader({
  eyebrow,
  title,
  description,
  actions,
  mobileAction,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Phones: a trailing navigation-bar button, as on iOS. The caption and `actions` row is then not shown on phones. */
  mobileAction?: ReactNode;
}) {
  const t = useTranslations();
  return (
    <>
      {/* Phones: iOS 26 bar (back to the tools list, centred title), then the caption and actions. */}
      {/* `contents` so the bar sticks to the page, not to this wrapper. */}
      <div className="contents md:hidden print:hidden">
        <div className="sticky top-0 z-20 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 bg-canvas/85 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
          <Link href={Routes.Tools} aria-label={t("common.back")} data-button-radius="pill" className="grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 text-ios-label shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10">
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <h1 className="truncate text-center text-[17px] font-semibold">{title}</h1>
          {mobileAction ?? <span aria-hidden="true" />}
        </div>
        {!mobileAction && (description || actions) && (
          <div className="flex items-start gap-3 px-ios-inset pb-3 pt-1">
            {description && <p className="min-w-0 flex-1 text-[15px] leading-5 text-ios-label-secondary">{description}</p>}
            {actions && <div className="shrink-0 [&_button]:min-h-11">{actions}</div>}
          </div>
        )}
      </div>
      <header className="hidden md:block print:block border-b border-border bg-surface px-4 py-5 sm:px-6 md:px-7 md:py-6">
        <div className="mx-auto flex w-full max-w-[94rem] flex-col items-start gap-3 sm:flex-row sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-primary-600">
              {eyebrow}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">{title}</h1>
            {description && (
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          {actions && <div className="shrink-0 sm:pt-0.5">{actions}</div>}
        </div>
      </header>
    </>
  );
}
