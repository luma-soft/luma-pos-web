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
        "[&>a]:w-full [&>a]:justify-center [&>a]:whitespace-normal [&>a]:text-center xl:[&>a]:w-auto",
        "[&>button]:w-full [&>button]:justify-center [&>button]:whitespace-normal [&>button]:text-center xl:[&>button]:w-auto",
        "[&>div]:w-full [&>div]:min-w-0 xl:[&>div]:w-auto",
        "[&>div>button]:w-full [&>div>button]:justify-center [&>div>button]:whitespace-normal [&>div>button]:text-center xl:[&>div>button]:w-auto",
        "[&>div>span]:break-words",
        alignEnd && "xl:justify-end",
      )}
    >
      {children}
    </div>
  );
}
