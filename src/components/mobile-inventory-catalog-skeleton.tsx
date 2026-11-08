import { TableSkeleton } from "@/components/table-skeleton";

/** A single consistent placeholder for server streaming and IndexedDB restore.
 * No effects or subscriptions; desktop still receives its original table loader.
 */
export function MobileInventoryCatalogSkeleton() {
  return (
    <>
      <div className="space-y-3 lg:hidden" aria-hidden="true">
        <div className="grid h-12 grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          <div className="rounded-full bg-surface" />
          <div className="rounded-full bg-surface/50" />
        </div>
        <div className="flex gap-2">
          <div className="h-11 min-w-0 flex-1 rounded-xl bg-surface-2" />
          <div className="h-11 w-11 rounded-xl bg-surface-2" />
          <div className="h-11 w-11 rounded-xl bg-surface-2" />
        </div>
        <div className="divide-y divide-border-soft overflow-hidden rounded-xl border border-border bg-surface">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex min-h-[94px] items-center gap-3 px-3 py-3">
              <div className="h-16 w-16 shrink-0 rounded-xl bg-surface-2" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-surface-2" />
                <div className="h-3 w-1/2 rounded bg-surface-2" />
                <div className="h-3 w-2/5 rounded bg-surface-2" />
              </div>
              <div className="w-20 shrink-0 space-y-2">
                <div className="h-4 w-full rounded bg-surface-2" />
                <div className="h-3 w-3/4 rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden lg:block" aria-hidden="true">
        <TableSkeleton cols={8} rows={10} />
      </div>
    </>
  );
}
