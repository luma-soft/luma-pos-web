"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { usePhoneLayout } from "@/components/use-phone-layout";

/** Server-rendered page plus a server action that returns the rows of another page. */
export type LoadMoreSource<T> = {
  page: number;
  pageCount: number;
  loadPage: (page: number) => Promise<T[]>;
};

type LoadState<T> = {
  base: readonly T[];
  extra: T[];
  next: number;
  status: "idle" | "loading" | "error" | "done";
};

function initialState<T>(rows: readonly T[], source: LoadMoreSource<T> | undefined): LoadState<T> {
  const next = (source?.page ?? 1) + 1;
  return {
    base: rows,
    extra: [],
    next,
    status: !source || next > source.pageCount ? "done" : "idle",
  };
}

/**
 * Phones load the next page automatically when the end of a list scrolls into
 * view (like the native lists), instead of showing desktop pagination. Desktop
 * receives the server rows unchanged. A new server render (filter, search)
 * resets the appended pages.
 */
export function useMobileLoadMore<T>(
  rows: readonly T[],
  source: LoadMoreSource<T> | undefined,
  getKey: (row: T) => string,
): { rows: T[]; footer: ReactNode } {
  const phone = usePhoneLayout();
  const [state, setState] = useState(() => initialState(rows, source));
  if (state.base !== rows) setState(initialState(rows, source));

  const loadingRef = useRef(false);
  const getKeyRef = useRef(getKey);
  useEffect(() => {
    getKeyRef.current = getKey;
  });

  const loadNext = useCallback(() => {
    if (!source || loadingRef.current) return;
    if (state.status === "done" || state.status === "loading") return;
    const page = state.next;
    const base = state.base;
    loadingRef.current = true;
    setState((current) => (current.base === base ? { ...current, status: "loading" } : current));
    source.loadPage(page)
      .then((pageRows) => {
        setState((current) => {
          if (current.base !== base) return current;
          const seen = new Set([...current.base, ...current.extra].map((row) => getKeyRef.current(row)));
          const fresh = pageRows.filter((row) => !seen.has(getKeyRef.current(row)));
          const next = page + 1;
          return {
            ...current,
            extra: [...current.extra, ...fresh],
            next,
            status: pageRows.length === 0 || next > source.pageCount ? "done" : "idle",
          };
        });
      })
      .catch(() => {
        setState((current) => (current.base === base ? { ...current, status: "error" } : current));
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [source, state.base, state.next, state.status]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const active = phone && state.status === "idle";
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!active || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNext();
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, loadNext]);

  const footer = phone && source ? (
    <MobileLoadMoreFooter
      sentinelRef={sentinelRef}
      status={state.status}
      onRetry={() => {
        setState((current) => ({ ...current, status: "idle" }));
      }}
    />
  ) : null;

  return {
    rows: phone && state.extra.length > 0 ? [...state.base, ...state.extra] : [...state.base],
    footer,
  };
}

function MobileLoadMoreFooter({
  sentinelRef,
  status,
  onRetry,
}: {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  status: LoadState<unknown>["status"];
  onRetry: () => void;
}) {
  const t = useTranslations();
  return (
    <div ref={sentinelRef} className="flex min-h-11 items-center justify-center py-3 lg:hidden" aria-live="polite">
      {status === "loading" && (
        // LumaLoadMoreSpinner
        <Loader2 className="size-5 animate-spin text-ios-label-secondary" aria-label={t("common.loading")} />
      )}
      {status === "error" && (
        <button type="button" onClick={onRetry} className="min-h-11 px-4 text-[15px] font-semibold text-ios-accent">
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

/**
 * Lists paged in the browser (offline catalog): phones grow the visible page count
 * as the end scrolls into view. Returns how many pages to show from page 1; desktop
 * keeps its own page. `resetKey` restarts from one page when filters change.
 */
export function useMobileGrowingPages(resetKey: string, total: number, pageSize: number) {
  const phone = usePhoneLayout();
  const [state, setState] = useState({ key: resetKey, pages: 1 });
  const pages = state.key === resetKey ? state.pages : 1;
  const hasMore = phone && pages * pageSize < total;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setState((current) => ({ key: resetKey, pages: (current.key === resetKey ? current.pages : 1) + 1 }));
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, pages, resetKey]);

  return {
    phone,
    pages,
    footer: phone ? <div ref={sentinelRef} className="h-px lg:hidden" aria-hidden="true" /> : null,
  };
}

/** Wraps desktop pagination so phones rely on automatic loading instead. */
export function DesktopPagination({ children }: { children: ReactNode }) {
  return <div className="max-lg:hidden">{children}</div>;
}
