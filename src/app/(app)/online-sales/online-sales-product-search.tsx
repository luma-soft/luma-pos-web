"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Store, X } from "lucide-react";
import { searchPosProducts } from "@/lib/actions/pos-search";
import type { PosProduct } from "@/lib/data/pos";
import { Routes } from "@/lib/routes";
import { categoryEmoji } from "@/lib/category-emoji";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export function OnlineSalesListingButton({ L }: { L: boolean }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [results, setResults] = useState<PosProduct[]>([]);
  const [isPending, startTransition] = useTransition();

  const query = search.trim();
  const showResults = browsing || query !== "";

  useEffect(() => {
    if (!open) return;
    function resetAndClose() {
      setOpen(false);
      setBrowsing(false);
      setSearch("");
      setResults([]);
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) resetAndClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") resetAndClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  function closeModal() {
    setOpen(false);
    closeSearch();
  }

  function openListing(productId: string) {
    const params = new URLSearchParams({ tab: "products", onlineProductId: productId });
    router.push(`${Routes.Inventory}?${params.toString()}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
      >
        <Store className="h-4 w-4" />
        {L ? "Đăng bán" : "List product"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5">
          <div ref={rootRef} className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{L ? "Đăng bán" : "List product"}</div>
                <h2 className="text-lg font-extrabold">{L ? "Chọn sản phẩm để đăng sàn" : "Choose a product to list online"}</h2>
                <p className="mt-1 text-xs text-slate-500">{L ? "Tìm sản phẩm trong kho, sau đó hoàn thiện thông tin Shopee ở bước tiếp theo." : "Search inventory, then complete Shopee listing details in the next step."}</p>
              </div>
              <button type="button" onClick={closeModal} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border hover:bg-surface-2" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  autoFocus
                  onChange={(event) => setSearch(event.target.value)}
                  onFocus={() => setBrowsing(true)}
                  placeholder={L ? "Tìm theo tên, SKU hoặc barcode..." : "Search by name, SKU, or barcode..."}
                  className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-10 text-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
                {showResults && (
                  <button
                    type="button"
                    onClick={closeSearch}
                    title={L ? "Xóa tìm kiếm" : "Clear search"}
                    className="absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-3 max-h-[min(58dvh,460px)] overflow-auto rounded-xl border border-border bg-canvas">
                {isPending ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {L ? "Đang tìm..." : "Searching..."}
                    </span>
                  </div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">
                    {query ? (L ? "Không tìm thấy sản phẩm." : "No products found.") : (L ? "Nhập tên, SKU hoặc barcode sản phẩm." : "Type a product name, SKU, or barcode.")}
                  </div>
                ) : (
                  <div className="divide-y divide-border-soft bg-surface">
                    {results.slice(0, 60).map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => openListing(product.id)}
                        className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-lg">
                          {categoryEmoji(product.categoryName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{product.name}</div>
                          <div className={cn("text-xs", Number(product.stock) <= 0 ? "text-er" : "text-slate-400")}>
                            {product.isVariantParent
                              ? `${product.children.length} SKU con`
                              : `${product.sku} · ${L ? "Tồn" : "Stock"} ${formatNumber(Number(product.stock))} ${product.baseUnit}`}
                          </div>
                        </div>
                        <div className="flex w-40 shrink-0 items-center justify-end gap-3">
                          <span className="hidden truncate text-right text-sm font-semibold tabular-nums text-primary-600 sm:block">
                            {product.isVariantParent ? variantPriceLabel(product) : `${formatCurrency(Number(product.retailPrice))}/${product.baseUnit}`}
                          </span>
                          <Store className="h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function variantPriceLabel(product: PosProduct) {
  const min = Number(product.minRetailPrice ?? product.retailPrice);
  const max = Number(product.maxRetailPrice ?? product.retailPrice);
  return min !== max ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(max);
}
