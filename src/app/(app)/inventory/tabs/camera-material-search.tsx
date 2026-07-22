"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function CameraMaterialSearch({ value, placeholder }: { value: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query === value) return;
      const next = new URLSearchParams(params.toString());
      next.set("tab", "camera-materials");
      next.set("cameraMaterials", "1");
      next.delete("expanded");
      next.delete("page");
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [params, pathname, query, router, value]);

  return (
    <div className="relative mb-4 w-full max-w-2xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
        autoComplete="off"
      />
    </div>
  );
}
