/**
 * Keeps a list screen's filters when an action (merge, delete, save from a
 * modal/form) navigates back to that list with a hard-coded destination such
 * as `/sales?tab=orders&detailOrderId=…`.
 *
 * The app shell records the latest query of every route; callers wrap their
 * destination with `withListFilters` so the remembered filters (search,
 * status, date range, paging…) are carried over and only the destination's
 * own params (tab, detail id) override them.
 */

/** URL fields that open overlays/details; they are never list filters. */
export const OVERLAY_ONLY_PARAMS = [
  "detailOrderId", "detailPurchaseId", "detailCustomerId", "detailSupplierId",
  "detailProductId", "detailTab",
  "productModal", "copyFrom", "copyGroup", "sameTypeAs",
  "returnTo", "onlineListing", "onlineProductId", "shopeeProductId",
] as const;

const TRANSIENT_PARAMS = [
  ...OVERLAY_ONLY_PARAMS,
  "expanded", "expandedReturn", "createdProductId",
];

const lastQueryByPath = new Map<string, string>();

export function rememberListLocation(pathname: string, query: string) {
  lastQueryByPath.set(pathname, query);
}

export function forgetListLocations() {
  lastQueryByPath.clear();
}

/** Merge the remembered list filters for `href`'s path into `href`. */
export function withListFilters(href: string): string {
  const [beforeHash, hash = ""] = href.split("#");
  const [pathname, query = ""] = beforeHash.split("?");
  const remembered = lastQueryByPath.get(pathname);
  if (!remembered) return href;

  const target = new URLSearchParams(query);
  const base = new URLSearchParams(remembered);
  const rememberedTab = base.get("tab");
  const targetTab = target.get("tab");
  // Filters belong to one tab; never leak them into another tab's list.
  if (rememberedTab && targetTab && rememberedTab !== targetTab) return href;

  const isProductEditor = base.has("productModal");
  for (const key of TRANSIENT_PARAMS) base.delete(key);
  if (isProductEditor) {
    base.delete("productId");
    base.delete("productKind");
  }
  for (const key of new Set(target.keys())) {
    const values = target.getAll(key);
    // set() keeps the remembered position, so the URL stays stable.
    base.set(key, values[0]);
    for (const value of values.slice(1)) base.append(key, value);
  }
  const merged = base.toString();
  return `${pathname}${merged ? `?${merged}` : ""}${hash ? `#${hash}` : ""}`;
}
