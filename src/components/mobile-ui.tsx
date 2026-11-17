import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileRecordCardProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

type MobileRecordFieldProps = {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
};

type MobileFormLineCardProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  amount?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function MobileRecordCard({ title, subtitle, status, children, actions, className }: MobileRecordCardProps) {
  return (
    <article className={cn("rounded-2xl bg-surface p-4 shadow-e1 lg:hidden", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-black">{title}</h3>
          {subtitle != null && <p className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {status != null && <div className="shrink-0">{status}</div>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{children}</dl>
      {actions != null && <div className="mt-3 flex min-h-11 items-center gap-2 border-t border-border-soft pt-2">{actions}</div>}
    </article>
  );
}

export function MobileRecordField({ label, value, tone = "neutral", className }: MobileRecordFieldProps) {
  const valueTone = {
    neutral: "",
    success: "text-ok",
    warning: "text-warn",
    danger: "text-er",
  }[tone];

  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-bold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-black tabular-nums", valueTone)}>{value}</dd>
    </div>
  );
}

export function MobileFormLineCard({ title, subtitle, amount, children, actions }: MobileFormLineCardProps) {
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-e1 lg:hidden">
      <div className="grid min-w-0 grid-cols-1 gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black">{title}</h3>
          {subtitle != null && <p className="mt-0.5 truncate text-xs font-medium text-slate-400">{subtitle}</p>}
        </div>
        {amount != null && <div className="min-w-0 text-right text-sm font-black tabular-nums [overflow-wrap:anywhere]">{amount}</div>}
      </div>
      <div className="mt-3">{children}</div>
      {actions != null && <div className="mt-3 flex min-h-11 items-center gap-2 border-t border-border-soft pt-2">{actions}</div>}
    </section>
  );
}

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
    // Native large-title navigation header: 34pt bold title on the grouped background, no bar or divider.
    <header className={cn("bg-canvas px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:hidden", className)}>
      <div className="flex min-h-[52px] items-center gap-2">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[34px] font-bold leading-[41px] tracking-[0.01em]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] font-normal leading-[18px] text-ios-label-secondary">{subtitle}</p>}
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
      {bottom && <div className="mt-2.5">{bottom}</div>}
    </header>
  );
}

export function TouchTargetToggle({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="relative h-11 w-11 shrink-0 rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:h-[21px] lg:w-[38px]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1/2 top-1/2 h-[21px] w-[38px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[15px] w-[15px] rounded-full bg-white shadow-sm transition-[left]",
            checked ? "left-[20px]" : "left-[3px]",
          )}
        />
      </span>
    </button>
  );
}

type MobileIconTint = "accent" | "green" | "orange" | "red";

const iconTintClass: Record<MobileIconTint, string> = {
  accent: "text-ios-accent",
  green: "text-ios-green",
  orange: "text-ios-orange",
  red: "text-ios-red",
};

/** DashboardSummaryCardContainer / quick-action card: 22pt continuous card on the grouped background. */
export function MobileGroupedCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-[22px] bg-surface px-4 py-3", className)}>{children}</section>;
}

/** Headline-bold card title with an optional "See all ›" accent link (DashboardSeeAllLabel). */
export function MobileCardHeader({ title, href, linkLabel }: { title: React.ReactNode; href?: string; linkLabel?: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <h2 className="min-w-0 truncate text-[17px] font-bold leading-[22px]">{title}</h2>
      {href && linkLabel && (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[15px] font-semibold text-ios-accent -my-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent">
          {linkLabel}
          <ChevronRight className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** Capsule segmented control rendered as links (LumaSegmentedControl). */
export function MobileSegmentedLinks({
  label,
  items,
}: {
  label: string;
  items: Array<{ href: string; label: React.ReactNode; active: boolean }>;
}) {
  return (
    <nav aria-label={label} className="flex rounded-full bg-primary-600/[0.075] p-[3px]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          data-button-radius="pill"
          aria-current={item.active ? "page" : undefined}
          className={cn(
            // Options size to their labels (singleLineTitles) and the text scales down like minimumScaleFactor.
            "flex min-h-11 min-w-0 flex-auto items-center justify-center whitespace-nowrap rounded-full px-2.5 text-center text-[min(15px,3.6vw)] font-semibold tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-accent",
            item.active ? "bg-primary-600 text-white" : "text-ios-label/85",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Inner summary tile (DashboardSummaryView.metricTileContent): 18pt tile on systemBackground. */
export const mobileMetricTileClass = "block min-h-[88px] w-full min-w-0 rounded-[18px] bg-white px-3 py-2.5 text-left shadow-[0_1px_4px_rgb(0_0_0/0.06)] transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent dark:bg-black dark:shadow-none";

export type MobileMetricTileContentProps = {
  icon: LucideIcon;
  tint?: MobileIconTint;
  label: React.ReactNode;
  value: React.ReactNode;
  detail: React.ReactNode;
  showsChevron?: boolean;
  accessory?: React.ReactNode;
};

export function MobileMetricTileContent({
  icon: Icon,
  tint = "accent",
  label,
  value,
  detail,
  showsChevron = false,
  accessory,
}: MobileMetricTileContentProps) {
  return (
    <>
      <span className="flex h-5 items-center gap-1.5">
        <Icon className={cn("size-[18px] shrink-0", iconTintClass[tint])} strokeWidth={2.4} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[min(15px,3.4vw)] font-semibold tracking-[-0.01em] text-ios-label-secondary">{label}</span>
        {accessory}
      </span>
      <span className="mt-1 flex h-6 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[20px] font-bold leading-6 tabular-nums text-ios-label">{value}</span>
        {showsChevron && <ChevronRight className="size-[15px] shrink-0 text-ios-label-tertiary" strokeWidth={2.75} aria-hidden="true" />}
      </span>
      <span className="mt-1 block h-4 truncate text-[12px] leading-4 text-ios-label-secondary">{detail}</span>
    </>
  );
}

export function MobileMetricTile({ href, showsChevron = Boolean(href), ...content }: MobileMetricTileContentProps & { href?: string }) {
  const body = <MobileMetricTileContent {...content} showsChevron={showsChevron} />;
  return href
    ? <Link href={href} className={mobileMetricTileClass}>{body}</Link>
    : <div className={mobileMetricTileClass}>{body}</div>;
}

export function MobileQuickActionGrid({
  title,
  items,
}: {
  title: React.ReactNode;
  items: Array<{ href: string; icon: LucideIcon; label: React.ReactNode }>;
}) {
  return (
    <section className="rounded-[22px] bg-surface px-4 py-[11px]">
      <h2 className="text-[17px] font-bold leading-[22px]">{title}</h2>
      <div className="mt-2.5 grid grid-cols-4 gap-1">
        {items.map(({ href, icon: Icon, label }, index) => (
          <Link
            key={`${index}-${href}`}
            href={href}
            className="flex min-h-[74px] min-w-0 flex-col items-center gap-1.5 text-center transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent"
          >
            <span className="grid size-[50px] shrink-0 place-items-center rounded-full bg-primary-600/12 text-primary-600">
              <Icon className="size-[22px]" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="w-full truncate text-[12px] font-semibold leading-[18px]">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MobileSectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-0.5 text-[13px] font-semibold leading-5 text-slate-500 dark:text-slate-400">{children}</h2>;
}

export function MobileActionRow({
  href,
  icon: Icon,
  title,
  subtitle,
  tone = "teal",
  className,
  target,
}: {
  href: string;
  icon: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "teal" | "blue" | "orange" | "purple" | "red";
  className?: string;
  target?: "_blank";
}) {
  const iconTone = {
    teal: "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300",
    blue: "bg-in-soft text-in",
    orange: "bg-warn-soft text-warn",
    purple: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    red: "bg-er-soft text-er",
  }[tone];
  return (
    <Link href={href} target={target} rel={target ? "noopener noreferrer" : undefined} className={cn(
      "flex min-h-[68px] min-w-11 items-center gap-3 rounded-2xl bg-surface px-3 py-3 shadow-e1 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.99]",
      className,
      "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
    )}>
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", iconTone)}>
        <Icon className="h-[21px] w-[21px]" strokeWidth={2.1} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs font-medium text-slate-500 dark:text-slate-400">{subtitle}</span>}
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
  target,
}: {
  href: string;
  icon: LucideIcon;
  label: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: "teal" | "blue" | "orange" | "purple" | "red";
  target?: "_blank";
}) {
  return (
    <MobileActionRow
      href={href}
      icon={Icon}
      title={label}
      subtitle={subtitle}
      tone={tone}
      target={target}
      className="rounded-none border-x-0 border-t-0 shadow-none last:border-b-0"
    />
  );
}
