import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PurchaseDetailActionGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center lg:justify-end",
        "[&>*]:min-w-0 [&>*:only-child]:col-span-2 lg:[&>*:only-child]:col-auto",
        "[&>a]:h-11 [&>a]:min-h-0 [&>a]:w-full [&>a]:justify-center [&>a]:whitespace-normal [&>a]:py-0 [&>a]:text-center lg:[&>a]:h-10 lg:[&>a]:w-auto",
        "[&>button]:h-11 [&>button]:min-h-0 [&>button]:w-full [&>button]:justify-center [&>button]:whitespace-normal [&>button]:py-0 [&>button]:text-center lg:[&>button]:h-10 lg:[&>button]:w-auto",
        "[&>div]:min-w-0 [&>div]:w-full lg:[&>div]:w-auto",
        "[&>div>button]:h-11 [&>div>button]:min-h-0 [&>div>button]:w-full [&>div>button]:justify-center [&>div>button]:whitespace-normal [&>div>button]:py-0 [&>div>button]:text-center lg:[&>div>button]:h-10 lg:[&>div>button]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
