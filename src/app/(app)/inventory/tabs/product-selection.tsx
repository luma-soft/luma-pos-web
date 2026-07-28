"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import {
  bulkDeleteProducts,
  bulkStopSellingProducts,
} from "@/lib/actions/products";
import { cn } from "@/lib/utils";

type ProductSelectionContextValue = {
  selectedIds: Set<string>;
  selectedVisibleIds: string[];
  allSelected: boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  replace: (ids: Set<string>) => void;
};

const ProductSelectionContext =
  createContext<ProductSelectionContextValue | null>(null);

export function ProductSelectionProvider({
  visibleIds,
  children,
}: {
  visibleIds: string[];
  children: ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const visibleKey = visibleIds.join(",");
  const stableVisibleIds = useMemo(
    () => (visibleKey ? visibleKey.split(",") : []),
    [visibleKey],
  );
  const selectedVisibleIds = stableVisibleIds.filter((id) =>
    selectedIds.has(id),
  );
  const allSelected =
    stableVisibleIds.length > 0 &&
    selectedVisibleIds.length === stableVisibleIds.length;

  useEffect(() => {
    const visible = new Set(stableVisibleIds);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection is scoped to the current filtered page
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [stableVisibleIds]);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      allSelected ? new Set() : new Set(stableVisibleIds),
    );
  }

  return (
    <ProductSelectionContext.Provider
      value={{
        selectedIds,
        selectedVisibleIds,
        allSelected,
        toggle,
        toggleAll,
        replace: setSelectedIds,
      }}
    >
      {children}
    </ProductSelectionContext.Provider>
  );
}

export function useProductSelection() {
  const context = useContext(ProductSelectionContext);
  if (!context) {
    throw new Error(
      "useProductSelection must be used inside ProductSelectionProvider",
    );
  }
  return context;
}

export function ProductBulkActions() {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const { selectedVisibleIds: ids, replace } = useProductSelection();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (ids.length === 0) return null;

  async function stopSelling() {
    setOpen(false);
    const confirmed = await dialog.confirm({
      title: t("products.bulk.stopTitle"),
      description: t("products.bulk.stopDescription", {
        count: ids.length,
      }),
      confirmLabel: t("products.actions.stopSelling"),
      variant: "warning",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await bulkStopSellingProducts(ids);
      if (!result.ok) {
        await dialog.alert({
          description: t(result.error as never),
          variant: "destructive",
        });
        return;
      }
      replace(new Set());
      router.refresh();
    });
  }

  async function remove() {
    setOpen(false);
    const confirmed = await dialog.confirm({
      title: t("products.bulk.deleteTitle"),
      description: t("products.bulk.deleteDescription", {
        count: ids.length,
      }),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await bulkDeleteProducts(ids);
      if (!result.ok) {
        await dialog.alert({
          description: t(result.error as never),
          variant: "destructive",
        });
        return;
      }
      const failed = new Set(result.data.failedIds);
      replace(failed);
      router.refresh();
      await dialog.alert({
        title: t("products.bulk.deleteResultTitle"),
        description:
          failed.size > 0
            ? t("products.bulk.deletePartial", {
                deleted: result.data.deleted,
                failed: failed.size,
              })
            : t("products.bulk.deleteSuccess", {
                count: result.data.deleted,
              }),
        variant: failed.size > 0 ? "warning" : "default",
      });
    });
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("products.bulk.moreWithCount", {
          count: ids.length,
        })}
        title={t("products.bulk.moreWithCount", {
          count: ids.length,
        })}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-surface-2 disabled:opacity-60 lg:min-h-0 lg:h-10",
          open && "border-primary-300 bg-primary-50 text-primary-700",
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MoreHorizontal className="h-5 w-5" />
        )}
        <span>{ids.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-56 rounded-xl border border-border bg-surface p-1 shadow-xl">
          <button
            type="button"
            onClick={stopSelling}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
          >
            <Ban className="h-4 w-4 text-amber-600" />
            {t("products.actions.stopSelling")}
          </button>
          <button
            type="button"
            onClick={remove}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
          >
            <Trash2 className="h-4 w-4" />
            {t("products.actions.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
