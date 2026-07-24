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
}: {
  base: string;
  items: GroupTab[];
  preserveParams?: readonly string[];
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
    <div className="flex items-center gap-1 overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:h-0">
      {items.map((it) => {
        const on = it.tab === active;
        return (
          <Link
            key={it.tab}
            href={tabHref(it.tab)}
            className={cn(
              "shrink-0 inline-flex items-center gap-2 px-3.5 h-9 rounded-[10px] text-xs font-semibold transition-colors",
              on ? "bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300" : "text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
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
