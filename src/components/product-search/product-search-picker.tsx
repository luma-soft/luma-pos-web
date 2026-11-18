"use client";

import { MobilePosSearchSkeleton } from "@/components/mobile-skeletons";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, CircleX, Loader2, Search, X } from "lucide-react";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { cn } from "@/lib/utils";
import { controlHeightClassName } from "@/components/ui/button-variants";
import {
  PRODUCT_SEARCH_DEBOUNCE_MS,
  ProductSearchRequestGate,
  nextProductSearchActiveIndex,
  shouldSelectProductSearchItem,
} from "./product-search-state";

export type ProductSearchPickerStatus = "ready" | "loading" | "unavailable";

export type ProductSearchPickerProps<T> = {
  query: string;
  onQueryChange: (query: string) => void;
  browseItems: readonly T[];
  loadItems: (query: string) => readonly T[] | Promise<readonly T[]>;
  itemKey: (item: T) => string;
  renderItem: (item: T, state: { active: boolean; selected: boolean }) => ReactNode;
  onSelect: (item: T) => void;
  isItemDisabled?: (item: T) => boolean;
  isItemSelected?: (item: T) => boolean;
  placeholder: string;
  emptyMessage: string;
  loadingMessage?: string;
  unavailableMessage?: string;
  closeLabel?: string;
  catalogStatus?: ProductSearchPickerStatus;
  debounceMs?: number;
  resultLimit?: number;
  pageSize?: number;
  keepOpenOnSelect?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  inputClassName?: string;
  surfaceClassName?: string;
  inputAriaLabel?: string;
  testId?: string;
  /**
   * Phones: open as a full-screen product search (iOS POSProductSearch) with a
   * back button, the result list and a footer "Done · N" when items are picked.
   */
  mobileFullScreen?: {
    title: string;
    subtitle?: string;
    backLabel: string;
    doneLabel: string;
    selectedCount: number;
  };
};

/**
 * Shared product picker interaction shell. Consumers own product-specific
 * filtering, mapping, row content, and selection rules.
 */
export function ProductSearchPicker<T>({
  query,
  onQueryChange,
  browseItems,
  loadItems,
  itemKey,
  renderItem,
  onSelect,
  isItemDisabled,
  isItemSelected,
  placeholder,
  emptyMessage,
  loadingMessage = "Đang tìm sản phẩm…",
  unavailableMessage = "Chưa thể tải danh mục sản phẩm.",
  closeLabel = "Đóng tìm kiếm sản phẩm",
  catalogStatus = "ready",
  debounceMs = PRODUCT_SEARCH_DEBOUNCE_MS,
  resultLimit = Number.MAX_SAFE_INTEGER,
  pageSize = 30,
  keepOpenOnSelect = false,
  open: controlledOpen,
  onOpenChange,
  className,
  inputClassName,
  surfaceClassName,
  inputAriaLabel,
  testId,
  mobileFullScreen,
}: ProductSearchPickerProps<T>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const fullScreen = Boolean(mobileFullScreen) && open;
  const [items, setItems] = useState<readonly T[]>(browseItems);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const paginationKey = `${pageSize}:${query}`;
  const [pagination, setPagination] = useState({ key: paginationKey, count: pageSize });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGateRef = useRef(new ProductSearchRequestGate());
  const listboxId = useId();

  const availableItems = useMemo(
    () => (query.trim() ? items : browseItems).slice(0, resultLimit),
    [browseItems, items, query, resultLimit],
  );
  const visibleCount = pagination.key === paginationKey ? pagination.count : pageSize;
  const visibleItems = useMemo(
    () => availableItems.slice(0, visibleCount),
    [availableItems, visibleCount],
  );
  const canLoadMore = visibleItems.length < availableItems.length;

  function loadNextPage() {
    setPagination({ key: paginationKey, count: visibleCount + pageSize });
  }

  function setOpen(next: boolean) {
    if (controlledOpen == null) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function close({ clear = true }: { clear?: boolean } = {}) {
    // Leaving the full-screen search must not leave the inline field focused (keyboard up).
    if (fullScreen && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setOpen(false);
    setActiveIndex(-1);
    if (clear) onQueryChange("");
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // close deliberately uses the current controlled callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onQueryChange]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    const requestId = requestGateRef.current.next();

    if (!normalized) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSearching(true);
      setFailed(false);
      Promise.resolve(loadItems(normalized))
        .then((nextItems) => {
          if (!requestGateRef.current.isLatest(requestId)) return;
          setItems(nextItems);
          setSearching(false);
        })
        .catch(() => {
          if (!requestGateRef.current.isLatest(requestId)) return;
          setItems([]);
          setFailed(true);
          setSearching(false);
        });
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [debounceMs, loadItems, open, query]);

  function isPhoneFullScreen() {
    return fullScreen && window.matchMedia("(max-width: 1023px)").matches;
  }

  /** Keeps the software keyboard up: refocus inside the same tap gesture (iOS allows it there). */
  function keepSearchFocus() {
    if (document.activeElement !== inputRef.current) inputRef.current?.focus({ preventScroll: true });
  }

  function select(item: T, { fromNestedField = false }: { fromNestedField?: boolean } = {}) {
    if (!shouldSelectProductSearchItem({
      selected: isItemSelected?.(item) ?? false,
      disabled: isItemDisabled?.(item) ?? false,
    })) return;
    onSelect(item);
    // The full-screen phone search stays open for multi-add, like the native picker.
    const keepOpen = keepOpenOnSelect || isPhoneFullScreen();
    if (!keepOpen) close();
    else {
      setOpen(true);
      setActiveIndex(-1);
      // Native POS search keeps the keyboard while picking several products.
      if (isPhoneFullScreen() && !fromNestedField) keepSearchFocus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (visibleItems.length === 0) return;
      setActiveIndex((current) => nextProductSearchActiveIndex(
        current,
        visibleItems.length,
        event.key === "ArrowDown" ? "next" : "previous",
      ));
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      const item = visibleItems[activeIndex];
      if (!item) return;
      event.preventDefault();
      select(item);
    }
  }

  const showUnavailable = failed || catalogStatus === "unavailable";
  const showLoading = searching || (catalogStatus === "loading" && visibleItems.length === 0);
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative min-w-0",
        className,
        fullScreen && "max-lg:fixed max-lg:inset-0 max-lg:z-[80] max-lg:flex max-lg:flex-col max-lg:bg-canvas max-lg:pt-[env(safe-area-inset-top)]",
      )}
      data-testid={testId}
      data-fullscreen={fullScreen || undefined}
    >
      {fullScreen && mobileFullScreen && (
        // LumaProductSelectionHeader: 52pt back button, 17pt heavy title, 12pt subtitle.
        <div className="flex items-center gap-3 bg-surface px-ios-inset pb-1 pt-3 lg:hidden">
          <button
            type="button"
            onClick={() => close()}
            aria-label={mobileFullScreen.backLabel}
            data-button-radius="pill"
            className="grid size-[52px] shrink-0 place-items-center rounded-[14px] border border-ios-stroke/50 bg-surface text-ios-label"
          >
            <ChevronLeft className="size-[22px]" strokeWidth={2.6} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-extrabold leading-[22px]">{mobileFullScreen.title}</div>
            {mobileFullScreen.subtitle && <div className="mt-0.5 truncate text-[12px] leading-4 text-ios-label-secondary">{mobileFullScreen.subtitle}</div>}
          </div>
        </div>
      )}
      <div className={cn("relative", fullScreen && "max-lg:border-b max-lg:border-border max-lg:bg-surface max-lg:px-ios-inset max-lg:py-ios-search")}>
      <Search className={cn("pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400", fullScreen && "max-lg:left-[30px] max-lg:size-[18px] max-lg:text-ios-label-secondary")} />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={inputAriaLabel ?? placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        value={query}
        onChange={(event) => {
          setActiveIndex(-1);
          setFailed(false);
          if (!event.target.value.trim()) setSearching(false);
          setOpen(true);
          onQueryChange(event.target.value);
        }}
        onFocus={() => {
          setActiveIndex(-1);
          setFailed(false);
          setSearching(false);
          setOpen(true);
        }}
        onClick={(event) => {
          selectAllInputOnClick(event);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(
          controlHeightClassName,
          "w-full rounded-xl border border-border bg-surface py-2 pl-10 pr-11 text-base outline-none transition-colors placeholder:text-slate-400 focus:border-primary-600 lg:pr-10 lg:text-sm",
          inputClassName,
          // LumaSearchFilterBar field: 52pt, 15pt radius, grouped background, hairline stroke, no focus ring.
          fullScreen && "max-lg:h-[52px] max-lg:rounded-[15px] max-lg:border-ios-stroke/50 max-lg:bg-canvas max-lg:pl-[42px] max-lg:pr-11 max-lg:text-[17px] max-lg:placeholder:text-ios-label-secondary max-lg:focus:border-ios-stroke/50",
        )}
      />
      {open && (!fullScreen || query) && (
        <button
          type="button"
          onMouseDown={(event) => { if (fullScreen) event.preventDefault(); }}
          onClick={() => {
            // Full-screen search clears the query in place; the back button leaves.
            if (isPhoneFullScreen()) {
              onQueryChange("");
              keepSearchFocus();
              return;
            }
            close();
          }}
          title={closeLabel}
          aria-label={closeLabel}
          className={cn("absolute right-0 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-surface-2 hover:text-slate-600 lg:right-2 lg:h-7 lg:w-7", fullScreen && "max-lg:right-[18px] max-lg:text-ios-label-tertiary")}
        >
          {fullScreen
            ? <><X className="h-4 w-4 max-lg:hidden" /><CircleX className="size-[18px] fill-current text-ios-label-tertiary [&>path]:stroke-surface lg:hidden" /></>
            : <X className="h-4 w-4" />}
        </button>
      )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-busy={showLoading}
          onScroll={(event) => {
            const target = event.currentTarget;
            if (canLoadMore && target.scrollHeight - target.scrollTop - target.clientHeight < 120) {
              loadNextPage();
            }
          }}
          className={cn(
            "absolute inset-x-0 top-full z-[60] mt-1 max-h-[min(64dvh,520px)] overflow-auto rounded-xl border border-border bg-surface shadow-e2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            surfaceClassName,
            fullScreen && "max-lg:static max-lg:mt-0 max-lg:max-h-none max-lg:min-h-0 max-lg:flex-1 max-lg:rounded-none max-lg:border-0 max-lg:bg-canvas max-lg:shadow-none",
          )}
        >
          {showLoading && fullScreen ? (
            <>
              {/* POSProductSearchSkeletonList on phones; the compact spinner stays for desktop. */}
              <MobilePosSearchSkeleton label={loadingMessage} />
              <div className="max-lg:hidden">
                <ProductSearchMessage icon={<Loader2 className="h-4 w-4 animate-spin" />} text={loadingMessage} />
              </div>
            </>
          ) : showLoading ? (
            <ProductSearchMessage icon={<Loader2 className="h-4 w-4 animate-spin" />} text={loadingMessage} />
          ) : showUnavailable ? (
            <ProductSearchMessage text={unavailableMessage} />
          ) : visibleItems.length === 0 ? (
            <ProductSearchMessage text={emptyMessage} />
          ) : (
            <div className={cn("py-1", fullScreen && "max-lg:py-0")}>
              {visibleItems.map((item, index) => {
                const active = index === activeIndex;
                const selected = isItemSelected?.(item) ?? false;
                return (
                  <div
                    id={`${listboxId}-option-${index}`}
                    key={itemKey(item)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={isItemDisabled?.(item) || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => {
                      // Nested quantity/price controls must be focusable; the
                      // default-prevention is only for row clicks so selecting
                      // a result does not steal focus from the search field.
                      if ((event.target as HTMLElement).closest("input,textarea,select")) return;
                      event.preventDefault();
                    }}
                    onClick={(event) => {
                      const fromNestedField = Boolean((event.target as HTMLElement).closest("input,textarea,select"));
                      select(item, { fromNestedField });
                      // Steppers and already-picked rows must not drop the keyboard either.
                      if (!fromNestedField && isPhoneFullScreen()) keepSearchFocus();
                    }}
                    className={cn(active && "bg-surface-2", fullScreen && "max-lg:border-b max-lg:border-border max-lg:bg-transparent")}
                  >
                    {renderItem(item, { active, selected })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {fullScreen && mobileFullScreen && mobileFullScreen.selectedCount > 0 && (
        <div className="border-t border-border bg-surface px-ios-inset pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
          <button
            type="button"
            onClick={() => close()}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-ios-accent text-[17px] font-bold text-white"
          >
            {mobileFullScreen.doneLabel}
            <span className="rounded-full bg-white/25 px-2 text-[15px] tabular-nums">{mobileFullScreen.selectedCount}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProductSearchMessage({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-6 text-center text-sm text-slate-400">
      {icon}{text}
    </div>
  );
}
