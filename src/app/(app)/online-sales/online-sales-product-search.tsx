"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Store, X } from "lucide-react";
import { searchPosProducts } from "@/lib/actions/pos-search";
import type { PosProduct } from "@/lib/data/pos";
import { Routes } from "@/lib/routes";
import { categoryEmoji } from "@/lib/category-emoji";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export function OnlineSalesProductSearch({ L }: { L: boolean }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [results, setResults] = useState<PosProduct[]>([]);
  const [isPending, startTransition] = useTransition();

  const query = search.trim();
  const showResults = browsing || query !== "";

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeSearch();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSearch();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!query) {
        setResults([]);
        return;
      }
      startTransition(async () => {
        const rows = await searchPosProducts(query);
        if (!cancelled) setResults(rows);
      });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function closeSearch() {
    setBrowsing(false);
    setSearch("");
    setResults([]);
  }

  function openListing(productId: string) {
    const params = new URLSearchParams({ tab: "products", onlineProductId: productId });
    router.push(`${Routes.Inventory}?${params.toString()}`);
  }

  return (
    <div ref={rootRef} className="relative w-full lg:w-[460px]">
      <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onFocus={() => setBrowsing(true)}
        placeholder={L ? "Tìm sản phẩm để đăng sàn..." : "Search products to list online..."}
        className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-10 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
      />

      {showResults && (
        <button
          type="button"
          onClick={closeSearch}
          title={L ? "Đóng" : "Close"}
          className="absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {showResults && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[min(64dvh,520px)] overflow-auto rounded-xl border border-border bg-surface shadow-e2">
          {isPending ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {L ? "Đang tìm..." : "Searching..."}
              </span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              {query ? (L ? "Không tìm thấy sản phẩm." : "No products found.") : (L ? "Nhập tên, SKU hoặc barcode sản phẩm." : "Type a product name, SKU, or barcode.")}
            </div>
          ) : (
            <div className="py-1">
              {results.slice(0, 60).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => openListing(product.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-lg">
                    {categoryEmoji(product.categoryName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{product.name}</div>
                    <div className={cn("text-xs", Number(product.stock) <= 0 ? "text-er" : "text-slate-400")}>
                      {product.isVariantParent
                        ? `${product.children.length} SKU con`
                        : `${product.sku} · ${L ? "Tồn" : "Stock"} ${formatNumber(Number(product.stock))} ${product.baseUnit}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-right text-sm font-semibold tabular-nums text-primary-600 sm:block">
                      {product.isVariantParent ? variantPriceLabel(product) : `${formatCurrency(Number(product.retailPrice))}/${product.baseUnit}`}
                    </span>
                    <Store className="h-4 w-4 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function variantPriceLabel(product: PosProduct) {
  const min = Number(product.minRetailPrice ?? product.retailPrice);
  const max = Number(product.maxRetailPrice ?? product.retailPrice);
  return min !== max ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(max);
}
