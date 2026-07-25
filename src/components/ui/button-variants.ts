import { cva, type VariantProps } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-primary-700",
        destructive:
          "bg-red-600 text-white hover:bg-red-700",
        outline:
          "border border-border bg-surface text-slate-700 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 dark:text-slate-200 dark:hover:bg-primary-950/30 dark:hover:text-primary-300",
        secondary:
          "border border-border bg-surface-2 text-slate-700 hover:bg-surface dark:text-slate-200",
        ghost:
          "text-slate-600 hover:bg-surface-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100",
        link:
          "text-primary-600 underline-offset-4 hover:underline",
        success:
          "bg-emerald-600 text-white hover:bg-emerald-700",
      },
      size: {
        sm: "h-10 px-3 text-xs sm:h-8",
        default: "h-11 px-4 py-2 text-sm sm:h-10",
        lg: "h-12 px-6 text-base",
        icon: "h-11 w-11 sm:h-10 sm:w-10",
        iconSm: "h-10 w-10 sm:h-8 sm:w-8",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      block: false,
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
