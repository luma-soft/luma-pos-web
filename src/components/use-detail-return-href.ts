"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { rememberDetailNavigation, resolveDetailHref } from "@/lib/detail-return";

/**
 * For a link to a record's detail modal: the href that keeps this page when
 * the modal closes (in place for orders/purchases, `returnTo` for partners),
 * and a click handler that records this page as the return target.
 */
export function useDetailReturnHref(detailHref: string, enabled = true) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const origin = enabled && pathname ? `${pathname}${query ? `?${query}` : ""}` : null;
  const { href, remember } = resolveDetailHref(detailHref, origin);
  return {
    href,
    onNavigate: () => {
      if (remember && origin) rememberDetailNavigation(origin);
    },
  };
}
