"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Search, XCircle } from "lucide-react";
import { MobileListRowContent, mobileListRowClass } from "@/components/mobile-ui";

export type MobileMoreSearchEntry = {
  href: string;
  label: string;
  subtitle?: string;
  external?: boolean;
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLocaleLowerCase().trim();
}

/** Search available More destinations without copying or refetching any data. */
export function MobileMoreQuickSearch({
  entries,
  children,
  searchLabel,
  emptyLabel,
  clearLabel,
}: {
  entries: readonly MobileMoreSearchEntry[];
  children: ReactNode;
  searchLabel: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalized(query);
  const results = useMemo(
    () => normalizedQuery
      ? entries.filter((entry) => normalized(`${entry.label} ${entry.subtitle ?? ""}`).includes(normalizedQuery))
      : [],
    [entries, normalizedQuery],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-6 lg:hidden">
        {/* .searchable(placement: .navigationBarDrawer): filled capsule under the large title. */}
        <div className="flex h-11 items-center gap-2 rounded-full bg-[rgb(118_118_128/0.12)] pl-3.5 pr-1 focus-within:ring-2 focus-within:ring-ios-accent/40 dark:bg-[rgb(118_118_128/0.24)]">
          <Search className="size-[19px] shrink-0 text-ios-label-secondary" strokeWidth={2.4} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            aria-label={searchLabel}
            placeholder={searchLabel}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] text-ios-label outline-none placeholder:text-ios-label-secondary [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={clearLabel} data-button-radius="pill"
              className="grid size-9 shrink-0 place-items-center rounded-full text-ios-label-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent">
              <XCircle className="size-[18px] fill-current text-ios-label-tertiary [&>path]:stroke-white dark:[&>path]:stroke-black" aria-hidden="true" />
            </button>
          )}
        </div>
        {normalizedQuery && (
          results.length ? (
            <div className="overflow-hidden rounded-[26px] bg-surface" role="region" aria-label={searchLabel}>
              {results.map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href}
                  target={entry.external ? "_blank" : undefined}
                  rel={entry.external ? "noopener noreferrer" : undefined}
                  onClick={() => setQuery("")}
                  className={mobileListRowClass}
                >
                  <MobileListRowContent icon={Search} title={entry.label} subtitle={entry.subtitle} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="size-10 text-ios-label-tertiary" aria-hidden="true" />
              <p className="text-[20px] font-bold">{emptyLabel}</p>
            </div>
          )
        )}
      </div>
      <div className={normalizedQuery ? "hidden lg:block lg:space-y-5" : "space-y-8 lg:space-y-5"}>
        {children}
      </div>
    </div>
  );
}
