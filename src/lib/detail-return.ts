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

export const RETURN_TO_PARAM = "returnTo";

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
  if (pending === target) return { kind: "back" };
  return { kind: "replace", href: target };
}
