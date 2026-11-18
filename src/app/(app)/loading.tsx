import { useTranslations } from "next-intl";
import { MobileListScreenSkeleton } from "@/components/mobile-skeletons";

/**
 * Skeleton hiện ngay khi chuyển trang (route động cần loading.tsx để Next prefetch
 * được layout shell → đổi trang thấy ngay khung thay vì trắng/chờ server query).
 */
export default function Loading() {
  const t = useTranslations();
  return (
    <>
    {/* Phones: native large title, search and NativeInvoiceHistorySkeleton rows. */}
    <MobileListScreenSkeleton label={t("common.loading")} />
    <div className="max-lg:hidden p-4 sm:p-6 animate-pulse">
      {/* header */}
      <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center">
          <div className="h-5 w-40 rounded bg-surface-2" />
        </div>
        <div className="px-4 sm:px-6 pb-1.5 flex items-center gap-1 overflow-hidden">
          {[80, 64, 96, 72, 64].map((w, i) => (
            <div key={i} className="h-9 rounded-[10px] bg-surface-2" style={{ width: w }} />
          ))}
        </div>
      </div>

      {/* toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-full max-w-sm rounded-lg bg-surface-2" />
        <div className="h-9 w-32 rounded-lg bg-surface-2" />
      </div>

      {/* rows */}
      <div className="bg-surface border border-border rounded-card overflow-hidden divide-y divide-border-soft">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 flex-1 rounded bg-surface-2" />
            <div className="h-4 w-24 rounded bg-surface-2" />
            <div className="h-4 w-20 rounded bg-surface-2" />
            <div className="h-4 w-16 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
