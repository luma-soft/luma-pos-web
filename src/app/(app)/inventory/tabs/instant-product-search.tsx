"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ListSearchInput } from "@/components/list-search-filter";

export function InstantProductSearch({ value, placeholder }: { value: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query === value) return;
      const next = new URLSearchParams(params.toString());
      next.delete("expanded");
      next.delete("page");
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [params, pathname, query, router, value]);

  return <ListSearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} autoComplete="off" />;
}
