import { forwardRef, type ButtonHTMLAttributes } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

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
