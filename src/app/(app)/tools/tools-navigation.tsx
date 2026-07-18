"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calculator, Tags } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Routes } from "@/lib/routes";

type ToolKey = "tileCalculator" | "electricalLabels";
type ToolGroupKey = "calculation" | "printing";
type ToolHref = typeof Routes.Tools | typeof Routes.ElectricalLabels;
type ToolGroup = {
  key: ToolGroupKey;
  items: { href: ToolHref; key: ToolKey; icon: ComponentType<{ className?: string }> }[];
};

const GROUPS: ToolGroup[] = [
  {
    key: "calculation",
    items: [
      { href: Routes.Tools, key: "tileCalculator", icon: Calculator },
    ],
  },
  {
    key: "printing",
    items: [
      { href: Routes.ElectricalLabels, key: "electricalLabels", icon: Tags },
    ],
  },
];

function useActiveTool() {
  const pathname = usePathname();
  return GROUPS.flatMap((group) => group.items).find((item) => pathname === item.href)?.href ?? Routes.Tools;
}

export function ToolsNavigation() {
  const t = useTranslations("toolsCenter");
  const activeHref = useActiveTool();

  return (
    <nav aria-label={t("title")} className="hidden w-55 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface md:flex">
      <div className="border-b border-border px-4 py-3.5">
        <div className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{t("title")}</div>
        <div className="mt-0.5 text-[10px] italic text-slate-400">{t("subtitle")}</div>
      </div>

      {GROUPS.map((group) => (
        <div key={group.key}>
          <div className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">
            {t(`groups.${group.key}`)}
          </div>
          {group.items.map((item) => {
            const active = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 border-l-2 px-3.5 py-2 text-xs font-semibold transition",
                  active
                    ? "border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
                    : "border-transparent text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(`items.${item.key}`)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function ToolsMobilePicker() {
  const t = useTranslations("toolsCenter");
  const router = useRouter();
  const activeHref = useActiveTool();
  const options = GROUPS.flatMap((group) => group.items.map((item) => ({
    value: item.href,
    label: `${t(`groups.${group.key}`)} · ${t(`items.${item.key}`)}`,
  })));

  return (
    <div className="border-b border-border bg-surface px-4 py-3 md:hidden">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{t("title")}</span>
        <span className="text-[10px] italic text-slate-400">{t("subtitle")}</span>
      </div>
      <div className="[&>div]:w-full">
        <Select
          value={activeHref}
          options={options}
          onValueChange={(href) => router.push(href)}
          aria-label={t("selectTool")}
          className="w-full"
        />
      </div>
    </div>
  );
}
