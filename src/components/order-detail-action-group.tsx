import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OrderDetailActionGroup({
  label,
  alignEnd = false,
  children,
}: {
  label: string;
  alignEnd?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid min-w-0 grid-cols-2 gap-2 xl:flex xl:flex-wrap",
        "[&>*]:min-w-0 [&>*:only-child]:col-span-2 xl:[&>*:only-child]:col-auto",
        "[&>a]:h-11 [&>a]:min-h-0 [&>a]:w-full [&>a]:justify-center [&>a]:whitespace-normal [&>a]:py-0 [&>a]:text-center lg:[&>a]:h-10 xl:[&>a]:w-auto",
        "[&>button]:h-11 [&>button]:min-h-0 [&>button]:w-full [&>button]:justify-center [&>button]:whitespace-normal [&>button]:py-0 [&>button]:text-center lg:[&>button]:h-10 xl:[&>button]:w-auto",
        "[&>div]:w-full [&>div]:min-w-0 xl:[&>div]:w-auto",
        "[&>div>button]:h-11 [&>div>button]:min-h-0 [&>div>button]:w-full [&>div>button]:justify-center [&>div>button]:whitespace-normal [&>div>button]:py-0 [&>div>button]:text-center lg:[&>div>button]:h-10 xl:[&>div>button]:w-auto",
        "[&>div>span]:break-words",
        alignEnd && "xl:justify-end",
      )}
    >
      {children}
    </div>
  );
}
