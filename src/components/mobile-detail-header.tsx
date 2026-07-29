import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileDetailHeaderProps = {
  backHref?: string;
  backLabel: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  onBack?: () => void;
  flush?: boolean;
  stackActionsOnMobile?: boolean;
  className?: string;
};

export function MobileDetailHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  badge,
  actions,
  onBack,
  flush = false,
  stackActionsOnMobile = false,
  className,
}: MobileDetailHeaderProps) {
  const backClassName =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.96] lg:h-9 lg:w-9";
  const backContent = <ArrowLeft className="h-5 w-5 lg:h-4 lg:w-4" aria-hidden="true" />;

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1.5 sm:px-4",
        !flush && "-mx-4 -mt-4 mb-5 sm:-mx-6 sm:-mt-6",
        className,
      )}
    >
      {backHref ? (
        <Link href={backHref} aria-label={backLabel} className={backClassName}>
          {backContent}
        </Link>
      ) : (
        <button type="button" onClick={onBack} aria-label={backLabel} className={backClassName}>
          {backContent}
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[17px] font-black leading-tight tracking-[-0.01em]">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>

      {actions && (
        <div
          data-slot="mobile-detail-actions"
          className={cn(
            "shrink-0 items-center gap-2",
            stackActionsOnMobile
              ? "grid w-full min-w-0 grid-cols-2 [&>*]:min-w-0 [&>*:only-child]:col-span-2 [&>a]:h-auto [&>a]:min-h-11 [&>a]:w-full [&>a]:whitespace-normal [&>a]:py-2 [&>a]:text-center [&>button]:h-auto [&>button]:min-h-11 [&>button]:w-full [&>button]:whitespace-normal [&>button]:py-2 [&>button]:text-center lg:flex lg:w-auto lg:flex-wrap lg:justify-end lg:[&>*:only-child]:col-auto lg:[&>a]:w-auto lg:[&>button]:w-auto"
              : "flex",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
