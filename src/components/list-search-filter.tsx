import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type ListSearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  wrapperClassName?: string;
};

export const ListSearchInput = forwardRef<HTMLInputElement, ListSearchInputProps>(
  function ListSearchInput(
    { "aria-label": ariaLabel, className, placeholder, type = "search", wrapperClassName, ...props },
    ref,
  ) {
    return (
      <div className={cn("relative w-full", wrapperClassName)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={ref}
          type={type}
          aria-label={ariaLabel ?? (typeof placeholder === "string" ? placeholder : undefined)}
          placeholder={placeholder}
          className={cn(
            "min-h-11 w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
            className,
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
};

export const FilterTriggerButton = forwardRef<HTMLButtonElement, FilterTriggerButtonProps>(
  function FilterTriggerButton(
    {
      active = false,
      "aria-label": ariaLabel,
      className,
      hideLabelOnSmallScreens = false,
      label,
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
        className={cn(
          "relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-primary-600 bg-surface px-4 text-sm font-bold text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          className,
        )}
        {...props}
      >
        <SlidersHorizontal className="size-4" />
        <span className={cn(hideLabelOnSmallScreens && "hidden sm:inline")}>{label}</span>
        {active && (
          <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-surface bg-primary-600" />
        )}
      </button>
    );
  },
);

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
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <div className={cn("min-w-0 flex-1 lg:max-w-xl", searchClassName)}>{search}</div>
      {filter}
    </div>
  );
}
