"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function ProductModalCloseButton({
  closeHref,
  children,
  ...props
}: {
  closeHref?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const router = useRouter();
  return (
    <button
      type="button"
      {...props}
      onClick={() => closeHref ? router.replace(closeHref) : router.back()}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200 lg:h-9 lg:w-9"
    >
      {children}
    </button>
  );
}
