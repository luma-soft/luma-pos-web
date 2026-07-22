"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";

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
  labels: { allCategories: string; active: string; inactive: string; all: string; grouped: string; flat: string };
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
    <div className="flex flex-wrap items-center gap-3">
      <Select value={category} onChange={(event) => update("category", event.target.value)} options={[{ value: "", label: labels.allCategories }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} className="min-w-44" />
      <Select value={status} onChange={(event) => update("status", event.target.value)} options={[{ value: "active", label: labels.active }, { value: "inactive", label: labels.inactive }, { value: "all", label: labels.all }]} />
      <Select value={view} onChange={(event) => update("view", event.target.value)} options={[{ value: "grouped", label: labels.grouped }, { value: "flat", label: labels.flat }]} />
    </div>
  );
}
