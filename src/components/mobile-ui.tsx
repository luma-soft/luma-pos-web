import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileTopBar({
  title,
  subtitle,
  leading,
  trailing,
  bottom,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-border bg-surface px-4 pb-3 pt-3 lg:hidden", className)}>
      <div className="flex min-h-12 items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-black leading-tight tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs font-semibold leading-4 text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
      {bottom && <div className="mt-2.5">{bottom}</div>}
    </header>
  );
}

export function MobileMetricTile({
  label,
  value,
  subtitle,
  tone = "neutral",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  subtitle: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  const subtitleTone = {
    neutral: "text-slate-500 dark:text-slate-400",
    success: "text-ok",
    warning: "text-warn",
    info: "text-in",
  }[tone];
  return (
    <div className="min-h-[92px] rounded-2xl border border-border bg-surface p-3 shadow-e1">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-[21px] font-black leading-tight tracking-[-0.02em] tabular-nums">{value}</div>
      <div className={cn("mt-1 text-[10px] font-bold", subtitleTone)}>{subtitle}</div>
    </div>
  );
}

export function MobileSectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400">{children}</h2>;
}

export function MobileActionRow({
  href,
  icon: Icon,
  title,
  subtitle,
  tone = "teal",
  className,
}: {
  href: string;
  icon: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "teal" | "blue" | "orange" | "purple" | "red";
  className?: string;
}) {
  const iconTone = {
    teal: "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300",
    blue: "bg-in-soft text-in",
    orange: "bg-warn-soft text-warn",
    purple: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    red: "bg-er-soft text-er",
  }[tone];
  return (
    <Link href={href} className={cn("flex min-h-[62px] items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-e1 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.99]", className)}>
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", iconTone)}>
        <Icon className="h-[21px] w-[21px]" strokeWidth={2.1} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">{subtitle}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
    </Link>
  );
}

export function MobileSettingsRow({
  href,
  icon: Icon,
  label,
  subtitle,
  tone = "teal",
}: {
  href: string;
  icon: LucideIcon;
  label: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "teal" | "blue" | "orange" | "purple" | "red";
}) {
  return (
    <MobileActionRow
      href={href}
      icon={Icon}
      title={label}
      subtitle={subtitle}
      tone={tone}
      className="rounded-none border-x-0 border-t-0 shadow-none last:border-b-0"
    />
  );
}
