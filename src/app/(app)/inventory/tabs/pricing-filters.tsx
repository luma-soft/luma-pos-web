"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { InstantProductSearch } from "./instant-product-search";

export function PricingFilters({
  query,
  category,
  categories,
  labels,
}: {
  query: string;
  category: string;
  categories: { id: string; name: string }[];
  labels: { searchProducts: string; allCategories: string; searchCategories: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function updateCategory(value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (value) next.set("category", value);
    else next.delete("category");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      <InstantProductSearch value={query} placeholder={labels.searchProducts} />
      <Select
        value={category}
        onChange={(event) => updateCategory(event.target.value)}
        options={[
          { value: "", label: labels.allCategories },
          ...categories.map((item) => ({ value: item.id, label: item.name })),
        ]}
        aria-label={labels.allCategories}
        searchable
        searchPlaceholder={labels.searchCategories}
        menuMinWidth={320}
        rootClassName="w-full sm:w-64"
        className="min-w-0"
      />
    </div>
  );
}
