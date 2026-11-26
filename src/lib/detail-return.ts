/**
 * Cross-page detail links (e.g. a supplier name in the purchase list) open a
 * detail modal that lives on another page (`/partners?…&detailSupplierId=`).
 * Closing that modal must take the user back to the page they came from, not
 * leave them on the other page's list.
 *
 * The link adds `returnTo=<origin path+query>`. When the modal closes:
 * - if this tab navigated there through the link, go back in history (keeps
 *   the origin's scroll position and does not grow history);
 * - otherwise (reload, shared URL) replace the URL with `returnTo`.
 */

import { withListFilters } from "@/lib/list-return-navigation";

export const RETURN_TO_PARAM = "returnTo";

const BASE = "http://luma.local";

type NavigationLike = { currentEntry?: { index: number } | null; entries?: () => { url: string | null }[] };

/**
 * The previous same-tab history entry when it is a page of this app, read from
 * the Navigation API. Null when unknown (no API, first entry, other site).
 */
export function previousAppEntry(): URL | null {
  if (typeof window === "undefined") return null;
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  const index = nav?.currentEntry?.index ?? -1;
  if (index < 1 || typeof nav?.entries !== "function") return null;
  const url = nav.entries()[index - 1]?.url;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin === window.location.origin ? parsed : null;
  } catch {
    return null;
  }
}

function sameLocation(url: URL, href: string) {
  const other = new URL(href, url.origin);
  const left = new URLSearchParams(url.search);
  const right = new URLSearchParams(other.search);
  left.sort();
  right.sort();
  return url.pathname === other.pathname && left.toString() === right.toString();
}

/**
 * How to close a modal that is its own route or URL state (labels, stock
 * drawer, print pages): go back when the previous history entry is the page
 * that opened it (`isOpener`, by default any page on `fallbackHref`'s path),
 * otherwise replace with `fallbackHref` plus the list filters remembered for it.
 */
export function modalCloseAction(fallbackHref: string, isOpener?: (previous: URL) => boolean): { kind: "back" } | { kind: "replace"; href: string } {
  const previous = previousAppEntry();
  const fallbackPath = new URL(fallbackHref, BASE).pathname;
  const opened = previous && (isOpener ? isOpener(previous) : previous.pathname === fallbackPath);
  return opened ? { kind: "back" } : { kind: "replace", href: withListFilters(fallbackHref) };
}

/** A same-origin, app-relative path, or null. */
export function safeReturnHref(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  try {
    const url = new URL(candidate, "http://luma.local");
    if (url.origin !== "http://luma.local") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** `href` with `returnTo` set, or `href` unchanged when already on its page. */
export function withReturnTo(href: string, origin: string): string {
  const [path, query = ""] = href.split("?");
  const originPath = origin.split("?")[0];
  if (originPath === path) return href;
  const params = new URLSearchParams(query);
  params.set(RETURN_TO_PARAM, origin);
  return `${path}?${params.toString()}`;
}

/** The origin this tab most recently left through a cross-page detail link. */
let pendingReturnTo: string | null = null;

export function rememberDetailNavigation(returnTo: string) {
  pendingReturnTo = returnTo;
}

/**
 * How to leave a detail modal opened with `returnTo`: `back` when this tab
 * reached it through the link (the previous history entry is the origin),
 * otherwise `replace` with the origin.
 */
export function detailReturnAction(returnTo: string | null): { kind: "none" } | { kind: "back" } | { kind: "replace"; href: string } {
  const target = safeReturnHref(returnTo);
  if (!target) return { kind: "none" };
  const pending = pendingReturnTo;
  pendingReturnTo = null;
  const previous = previousAppEntry();
  if (pending === target || (previous && sameLocation(previous, target))) return { kind: "back" };
  return { kind: "replace", href: target };
}

const IN_PLACE_DETAIL_PARAMS = ["detailOrderId", "detailPurchaseId"] as const;

/**
 * Where a link to a record should go so closing the record's modal keeps the
 * page the user is on (`origin`, path+query):
 * - orders and purchases open in place: their modals are global parallel
 *   routes, so `origin` + `detailOrderId`/`detailPurchaseId` works anywhere;
 * - customers and suppliers live on /partners and carry `returnTo`
 *   (`remember` is true: call `rememberDetailNavigation(origin)` on click);
 * - anything else (intercepted product/project routes, plain pages) is kept.
 */
export function resolveDetailHref(href: string, origin: string | null): { href: string; remember: boolean } {
  const unchanged = { href, remember: false };
  if (!origin || !href.startsWith("/") || href.startsWith("//")) return unchanged;
  let url: URL;
  try {
    url = new URL(href, BASE);
  } catch {
    return unchanged;
  }
  if (url.origin !== BASE) return unchanged;

  const purchasePath = url.pathname.match(/^\/purchases\/([^/]+)$/);
  const inPlace: [string, string] | null = purchasePath && purchasePath[1] !== "new"
    ? ["detailPurchaseId", decodeURIComponent(purchasePath[1])]
    : IN_PLACE_DETAIL_PARAMS
      .map((key) => [key, url.searchParams.get(key)] as const)
      .find((entry): entry is [typeof entry[0], string] => Boolean(entry[1])) ?? null;
  if (inPlace) {
    const [originPath, originQuery = ""] = origin.split("?");
    const params = new URLSearchParams(originQuery);
    for (const key of IN_PLACE_DETAIL_PARAMS) params.delete(key);
    params.set(inPlace[0], inPlace[1]);
    return { href: `${originPath}?${params.toString()}`, remember: false };
  }

  if (url.pathname === "/partners" && (url.searchParams.has("detailCustomerId") || url.searchParams.has("detailSupplierId"))) {
    const next = withReturnTo(`${url.pathname}${url.search}`, origin);
    return { href: next, remember: next !== `${url.pathname}${url.search}` };
  }
  return unchanged;
}

/** The current page as path+query, in the browser. */
export function currentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}`;
}

/** Resolve `href` against the current page and record the origin when needed. */
export function prepareDetailNavigation(href: string): string {
  const origin = currentOrigin();
  const resolved = resolveDetailHref(href, origin);
  if (resolved.remember && origin) rememberDetailNavigation(origin);
  return resolved.href;
}
