"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";

export interface GroupTab {
  tab: string;
  labelKey: string;
  count?: number;
}

/** Thanh tab cho trang gộp (Bán hàng/Kho hàng/Đối tác/Tài chính) — đổi tab qua ?tab=. */
export function GroupTabs({
  base,
  items,
  preserveParams = [],
  edgeToEdge = true,
  linkClassName,
}: {
  base: string;
  items: GroupTab[];
  preserveParams?: readonly string[];
  edgeToEdge?: boolean;
  linkClassName?: string;
}) {
  const t = useTranslations();
  const sp = useSearchParams();
  const requestedTab = sp.get("tab");
  const active = items.some((item) => item.tab === requestedTab) ? requestedTab : items[0]?.tab;

  function tabHref(tab: string) {
    const nextParams = new URLSearchParams();
    nextParams.set("tab", tab);
    for (const key of preserveParams) {
      const value = sp.get(key);
      if (value) nextParams.set(key, value);
    }
    return `${base}?${nextParams.toString()}`;
  }

  return (
    <div className={cn(
      "flex snap-x snap-mandatory items-center gap-5 overflow-x-auto overscroll-x-contain scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:gap-1",
      edgeToEdge && "-mx-4 px-4 sm:-mx-6 sm:px-6",
    )}>
      {items.map((it) => {
        const on = it.tab === active;
        return (
          <Link
            key={it.tab}
            href={tabHref(it.tab)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 snap-start items-center gap-2 border-b-2 px-0.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:h-9 lg:rounded-[10px] lg:border-b-0 lg:px-3.5 lg:font-semibold",
              on
                ? "border-primary-600 text-primary-700 dark:text-primary-300 lg:bg-primary-50 lg:dark:bg-primary-950/40"
                : "border-transparent text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 lg:text-slate-500 lg:hover:bg-surface-2",
              linkClassName,
            )}
          >
            <Text as="span" size="xs" weight="semibold" className="text-current" text={t(it.labelKey)} />
            {it.count != null && it.count > 0 && (
              <Text as="span" weight="bold" className="min-w-4 h-4 px-1 rounded-full bg-surface-2 text-[9px] font-mono grid place-items-center text-current" text={it.count} />
            )}
          </Link>
        );
      })}
    </div>
  );
}
