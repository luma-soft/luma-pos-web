"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";

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
  searchLabel,
  emptyLabel,
  clearLabel,
}: {
  entries: readonly MobileMoreSearchEntry[];
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
    <div className="space-y-2 lg:hidden">
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-primary-500">
        <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
          aria-label={searchLabel}
          placeholder={searchLabel}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-slate-400"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label={clearLabel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {normalizedQuery && (
        <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border bg-surface" role="region" aria-label={searchLabel}>
          {results.length ? results.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              target={entry.external ? "_blank" : undefined}
              rel={entry.external ? "noopener noreferrer" : undefined}
              onClick={() => setQuery("")}
              className="flex min-h-12 items-center gap-2 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{entry.label}</span>
                {entry.subtitle && <span className="mt-0.5 block text-xs text-slate-500">{entry.subtitle}</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            </Link>
          )) : <p className="px-3 py-5 text-center text-sm text-slate-500">{emptyLabel}</p>}
        </div>
      )}
    </div>
  );
}
