"use client";

import {
  createContext,
  forwardRef,
  useContext,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ListFilter, Plus, Search, SlidersHorizontal } from "lucide-react";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { cn } from "@/lib/utils";
import { controlHeightClassName } from "@/components/ui/button-variants";

type ListSearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  wrapperClassName?: string;
};

export const ListSearchInput = forwardRef<HTMLInputElement, ListSearchInputProps>(
  function ListSearchInput(
    { "aria-label": ariaLabel, className, onClick, placeholder, type = "search", wrapperClassName, ...props },
    ref,
  ) {
    return (
      <div className={cn("relative w-full", wrapperClassName)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 max-lg:left-3.5 max-lg:size-[19px] max-lg:text-ios-label-secondary" strokeWidth={2.2} />
        <input
          ref={ref}
          type={type}
          onClick={(event) => {
            onClick?.(event);
            selectAllInputOnClick(event);
          }}
          aria-label={ariaLabel ?? (typeof placeholder === "string" ? placeholder : undefined)}
          placeholder={placeholder}
          className={cn(
            controlHeightClassName,
            "min-h-11 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-base outline-none transition focus:border-primary-500 lg:text-sm focus:ring-2 focus:ring-primary-100",
            // iOS search field: filled 48pt rounded rect with a hairline and 17pt text.
            "max-lg:h-12 max-lg:rounded-2xl max-lg:border-ios-stroke/50 max-lg:bg-[rgb(118_118_128/0.12)] max-lg:pl-11 max-lg:text-[17px] max-lg:placeholder:text-ios-label-secondary max-lg:focus:border-ios-accent max-lg:focus:ring-0 dark:max-lg:bg-[rgb(118_118_128/0.24)]",
            className,
            "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11 lg:min-h-0 lg:min-w-0",
          )}
          {...props}
        />
      </div>
    );
  },
);

type FilterTriggerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  hideLabelOnSmallScreens?: boolean;
  resultCount?: number;
};

export const FilterTriggerButton = forwardRef<HTMLButtonElement, FilterTriggerButtonProps>(
  function FilterTriggerButton(
    {
      active = false,
      "aria-label": ariaLabel,
      "aria-pressed": ariaPressed,
      className,
      hideLabelOnSmallScreens = false,
      label,
      resultCount,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel ?? label}
        aria-pressed={ariaPressed ?? active}
        className={cn(
          controlHeightClassName,
          "relative inline-flex shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          active
            ? "border-primary-600 bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-200 hover:bg-primary-100 dark:bg-primary-950/50 dark:text-primary-200 dark:ring-primary-800"
            : "border-primary-600 bg-surface text-primary-700 hover:bg-primary-50",
          className,
          "min-w-11 sm:min-w-11 md:min-w-11 lg:min-w-0",
          // iOS: 48pt square outlined icon button.
          "max-lg:size-12 max-lg:justify-center max-lg:rounded-2xl max-lg:border-ios-stroke/60 max-lg:bg-surface max-lg:px-0 max-lg:text-ios-accent max-lg:shadow-none max-lg:ring-0",
        )}
        {...props}
      >
        <SlidersHorizontal className="size-4 max-lg:hidden" />
        <ListFilter className="size-[22px] lg:hidden" strokeWidth={2.2} aria-hidden="true" />
        <span className={cn("max-lg:sr-only", hideLabelOnSmallScreens && "hidden sm:inline")}>{label}</span>
        {resultCount !== undefined && (
          <span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-[11px] tabular-nums text-primary-700 dark:bg-primary-950/50 dark:text-primary-200">
            {resultCount}
          </span>
        )}
        {active && (
          <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-surface bg-primary-600" />
        )}
      </button>
    );
  },
);

type ListPrimaryAction = { href: string; label: string };

const ListPrimaryActionContext = createContext<ListPrimaryAction | null>(null);

/** Lets a page put its create action beside the search/filter bar on phones (iOS "+" button). */
export function ListPrimaryActionProvider({ action, children }: { action: ListPrimaryAction | null; children: ReactNode }) {
  return <ListPrimaryActionContext.Provider value={action}>{children}</ListPrimaryActionContext.Provider>;
}

export function ListSearchFilterBar({
  className,
  filter,
  search,
  searchClassName,
}: {
  className?: string;
  filter: ReactNode;
  search: ReactNode;
  searchClassName?: string;
}) {
  const primaryAction = useContext(ListPrimaryActionContext);
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2 max-lg:gap-ios-search", className)}>
      <div className={cn("min-w-0 flex-1 lg:max-w-xl", searchClassName)}>{search}</div>
      {filter}
      {primaryAction && (
        <Link
          href={primaryAction.href}
          aria-label={primaryAction.label}
          data-button-radius="pill"
          className="grid size-12 shrink-0 place-items-center rounded-2xl border border-ios-stroke/60 bg-surface text-ios-accent transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent lg:hidden"
        >
          <Plus className="size-6" strokeWidth={2.2} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
