"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";

export function InstantProductFilters({
  category,
  status,
  view,
  categories,
  labels,
}: {
  category: string;
  status: string;
  view: string;
  categories: { id: string; name: string }[];
  labels: { filters: string; allCategories: string; active: string; inactive: string; all: string; grouped: string; flat: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <details className="group w-full sm:contents">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm font-bold text-slate-600 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:hidden">
        <SlidersHorizontal className="h-4 w-4" />
        {labels.filters}
      </summary>
      <div className="mt-2 grid w-full grid-cols-2 items-center gap-2 sm:mt-0 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
        <Select value={category} onChange={(event) => update("category", event.target.value)} options={[{ value: "", label: labels.allCategories }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} className="min-w-0 sm:min-w-44" />
        <Select value={status} onChange={(event) => update("status", event.target.value)} options={[{ value: "active", label: labels.active }, { value: "inactive", label: labels.inactive }, { value: "all", label: labels.all }]} className="min-w-0" />
        <Select value={view} onChange={(event) => update("view", event.target.value)} options={[{ value: "grouped", label: labels.grouped }, { value: "flat", label: labels.flat }]} className="col-span-2 min-w-0 sm:col-span-1" />
      </div>
    </details>
  );
}
