export type PricingSort = "recent_sales" | "updated" | "name" | "sku" | "cost" | "retail" | "stock";

export const pricingProjectionPolicy = {
  isVariantParent: false,
  isActive: true,
  lifecycleStatus: "active",
} as const;

export type PricingSortSpec = readonly [
  {
    key: "recentSales" | "updatedAt" | "name" | "sku" | "costPrice" | "effectivePrice" | "stock";
    direction: "asc" | "desc";
  },
  { key: "id"; direction: "asc" },
];

export function pricingSortSpec(sort: PricingSort): PricingSortSpec {
  const primary = (() => {
    switch (sort) {
      case "recent_sales":
        return { key: "recentSales", direction: "desc" } as const;
      case "name":
        return { key: "name", direction: "asc" } as const;
      case "sku":
        return { key: "sku", direction: "asc" } as const;
      case "cost":
        return { key: "costPrice", direction: "desc" } as const;
      case "retail":
        return { key: "effectivePrice", direction: "desc" } as const;
      case "stock":
        return { key: "stock", direction: "asc" } as const;
      default:
        return { key: "updatedAt", direction: "desc" } as const;
    }
  })();
  return [primary, { key: "id", direction: "asc" }];
}

export function parsePricingSort(value: string | undefined): PricingSort {
  return value === "recent_sales" ||
    value === "name" ||
    value === "sku" ||
    value === "cost" ||
    value === "retail" ||
    value === "stock"
    ? value
    : "updated";
}
