"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Box, Check, CheckCircle2, ChevronLeft, ChevronRight, Droplets, ListFilter, Network, Search, UserRound, Video, Zap, type LucideIcon } from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { legacyText } from "@/lib/i18n/catalog-text";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { ServiceProjectRow } from "@/lib/data/services";
import { ProjectQuickCreate } from "../projects/project-widgets";

const TRADE: Record<string, { icon: LucideIcon; tone: string }> = {
  camera: { icon: Video, tone: "bg-ios-accent/12 text-ios-accent" },
  electrical: { icon: Zap, tone: "bg-ios-orange/12 text-ios-orange" },
  plumbing: { icon: Droplets, tone: "bg-cyan-500/12 text-cyan-500" },
  mixed: { icon: Network, tone: "bg-violet-500/12 text-violet-500" },
};

type Filters = { type: string; status: string; urgency: string; sort: string };

const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";

/**
 * NativeProjectsView on phones: back / "Công trình" / "+" bar, project count,
 * search with a filter sheet, and one row per project that opens its detail.
 */
export function ServiceProjectsMobile({
  rows: serverRows,
  loadMore,
  total,
  customers,
  filters,
  query,
}: {
  rows: ServiceProjectRow[];
  loadMore: LoadMoreSource<ServiceProjectRow>;
  total: number;
  customers: { id: string; name: string }[];
  filters: Filters;
  query: string;
}) {
  const t = useTranslations("mobile.projects");
  const tc = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { rows, footer } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const [search, setSearch] = useState(query);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const activeCount = [filters.type, filters.status, filters.urgency].filter(Boolean).length + (filters.sort !== "starts_desc" ? 1 : 0);

  const replace = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const queryString = next.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (search.trim() === query) return;
    const timer = window.setTimeout(() => replace({ q: search.trim() }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on typed text only
  }, [search]);

  const groups: { key: keyof Filters; title: string; options: { value: string; label: string }[] }[] = [
    { key: "type", title: t("type"), options: [{ value: "", label: tc("services.filters.allTypes") }, ...["camera", "electrical", "plumbing", "mixed"].map((value) => ({ value, label: tc(`services.types.${value}` as never) }))] },
    { key: "status", title: t("status"), options: [{ value: "", label: tc("services.filters.allStatuses") }, { value: "active", label: tc("projects.status.active") }, { value: "done", label: tc("projects.status.done") }] },
    { key: "urgency", title: t("progress"), options: [{ value: "", label: legacyText(locale, "38cf1b7f8dc2") }, { value: "attention", label: legacyText(locale, "69a2b410b7ae") }, { value: "overdue", label: legacyText(locale, "66da0e7fb240") }] },
    { key: "sort", title: t("sort"), options: [
      { value: "starts_desc", label: legacyText(locale, "06a23ef9fceb") },
      { value: "starts_asc", label: legacyText(locale, "734a01a52f48") },
      { value: "target_asc", label: legacyText(locale, "54508e173558") },
      { value: "target_desc", label: legacyText(locale, "7bb9cc180282") },
    ] },
  ];

  return (
    <div className="min-h-dvh bg-surface lg:hidden">
      <header className="sticky top-0 z-20 bg-surface px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <Link href={Routes.More} aria-label={tc("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <h1 className="truncate text-center text-[17px] font-semibold">{t("title")}</h1>
          <ProjectQuickCreate customers={customers} serviceMode circleTrigger />
        </div>
      </header>

      <div className="px-ios-inset">
        <p className="pb-3 pt-2 text-[15px] text-ios-label-secondary">{t("count", { count: total })}</p>
        <div className="flex items-center gap-2.5 pb-3">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[19px] -translate-y-1/2 text-ios-label-secondary" strokeWidth={2.2} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-12 w-full rounded-[15px] border border-ios-stroke/40 bg-black/[0.04] pl-11 pr-3 text-[17px] outline-none placeholder:text-ios-label-tertiary focus-visible:ring-2 focus-visible:ring-ios-accent dark:bg-white/[0.06]"
            />
          </label>
          <button
            type="button"
            onClick={() => { setDraft(filters); setSheetOpen(true); }}
            aria-label={t("filters")}
            data-button-radius="pill"
            className={cn("relative grid size-12 shrink-0 place-items-center rounded-[15px] border border-ios-stroke/60 bg-surface text-ios-accent", activeCount > 0 && "bg-ios-accent text-white")}
          >
            <ListFilter className="size-6" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="h-px bg-border" aria-hidden="true" />
      {rows.length === 0 ? (
        <p className="px-ios-inset py-16 text-center text-[15px] text-ios-label-secondary">{t("empty")}</p>
      ) : (
        <div className="pb-6">
          {rows.map((row) => <ProjectRow key={row.id} row={row} />)}
          {footer}
        </div>
      )}

      <MobileActionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("filters")}>
        <div className="space-y-ios-section">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="px-1 pb-1.5 text-[15px] text-ios-label-secondary">{group.title}</h3>
              <div className="overflow-hidden rounded-[14px] bg-surface">
                {group.options.map((option) => (
                  <button
                    key={option.value || "all"}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, [group.key]: option.value }))}
                    className="flex min-h-12 w-full items-center gap-3 border-b border-border px-4 text-left text-[17px] last:border-b-0"
                  >
                    <span className="flex-1">{option.label}</span>
                    {draft[group.key] === option.value && <Check className="size-5 text-ios-accent" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setDraft({ type: "", status: "", urgency: "", sort: "starts_desc" })} className="h-[50px] rounded-[14px] border-[1.5px] border-ios-stroke/60 bg-surface text-[17px] font-semibold text-ios-accent">{t("clear")}</button>
            <button
              type="button"
              onClick={() => {
                setSheetOpen(false);
                replace({ type: draft.type, status: draft.status, urgency: draft.urgency, sort: draft.sort === "starts_desc" ? "" : draft.sort });
              }}
              className="h-[50px] rounded-[14px] bg-ios-accent text-[17px] font-semibold text-white"
            >
              {t("apply")}
            </button>
          </div>
        </div>
      </MobileActionSheet>
    </div>
  );
}

/** NativeProjectRow: tinted trade tile, name, customer, device count and status. */
function ProjectRow({ row }: { row: ServiceProjectRow }) {
  const t = useTranslations("mobile.projects");
  const trade = TRADE[row.serviceType ?? "camera"] ?? TRADE.camera;
  const Icon = trade.icon;
  const done = row.status === "done";
  return (
    <Link href={Routes.project(row.id)} className="relative block px-ios-inset py-4 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border active:bg-black/[0.04] dark:active:bg-white/[0.06]">
      <span className="flex items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", trade.tone)}>
          <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold leading-[22px]">{row.name}</span>
          <span className="mt-1 flex items-center gap-1.5 text-[15px] text-ios-label-secondary">
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{row.customerName ?? t("noCustomer")}</span>
          </span>
        </span>
        <ChevronRight className="size-[17px] shrink-0 text-ios-label-tertiary" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <span className="mt-2.5 flex items-center gap-1.5 text-[13px] text-ios-label-secondary">
        <Box className="size-4" aria-hidden="true" />
        <span>{t("assets", { count: row.assetCount })}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {done && <CheckCircle2 className="size-4" aria-hidden="true" />}
          {done ? t("done") : t("inProgress")}
        </span>
      </span>
    </Link>
  );
}
