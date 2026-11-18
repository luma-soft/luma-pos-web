import { useTranslations } from "next-intl";
import { MobileDocumentListSkeleton, MobileProductListSkeleton } from "@/components/mobile-skeletons";

/**
 * Desktop table placeholder. On phones it renders the native list skeleton instead:
 * `documents` for invoice-style lists, `products` for catalog-style lists.
 */
export function TableSkeleton({ cols = 5, rows = 8, mobile = "documents" }: { cols?: number; rows?: number; mobile?: "documents" | "products" }) {
  const t = useTranslations();
  return (
    <>
      {mobile === "products"
        ? <MobileProductListSkeleton label={t("common.loading")} />
        : <MobileDocumentListSkeleton label={t("common.loading")} />}
      <DesktopTableSkeleton cols={cols} rows={rows} />
    </>
  );
}

export function DesktopTableSkeleton({ cols = 5, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <div className="max-lg:hidden bg-surface border border-border rounded-card overflow-hidden animate-pulse">
      <div className="bg-canvas border-b border-border px-4 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={`h-3 rounded bg-slate-200 dark:bg-slate-700 ${i === 0 ? "flex-1" : "w-16"}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border-soft last:border-0">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
          {Array.from({ length: cols - 1 }).map((_, j) => (
            <div key={j} className="h-3.5 rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${40 + (j % 3) * 20}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
