"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { rememberDetailNavigation, withReturnTo } from "@/lib/detail-return";

/**
 * For a link to a detail modal on another page: the href carrying
 * `returnTo=<this page>`, and a click handler so closing that modal goes
 * back here instead of staying on the other page's list.
 */
export function useDetailReturnHref(detailHref: string, enabled = true) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const origin = pathname ? `${pathname}${query ? `?${query}` : ""}` : null;
  const href = enabled && origin ? withReturnTo(detailHref, origin) : detailHref;
  return {
    href,
    onNavigate: () => {
      if (href !== detailHref && origin) rememberDetailNavigation(origin);
    },
  };
}
