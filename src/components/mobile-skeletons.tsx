import { cn } from "@/lib/utils";

/**
 * Phone loading placeholders ported 1:1 from the native app's skeletons
 * (LumaLayoutComponents.swift, InvoiceHistoryRow.swift, InventoryProductListView.swift,
 * POSParityViews.swift, DashboardQuickActionsView.swift). Dimensions are iOS points.
 * Every export is `lg:hidden`; desktop keeps its table skeletons.
 */

/** Color.primary.opacity(0.08) */
const fill = "bg-black/[0.08] dark:bg-white/[0.08]";
/** tertiarySystemFill */
const tertiaryFill = "bg-[rgb(118_118_128/0.12)] dark:bg-[rgb(118_118_128/0.24)]";

function Bar({ w, h, r = 5, className }: { w?: number; h: number; r?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block shrink-0", fill, w == null && "w-full", className)}
      style={{ width: w, height: h, borderRadius: r }}
    />
  );
}

function Pill({ w, h, className }: { w?: number; h: number; className?: string }) {
  return <Bar w={w} h={h} r={999} className={className} />;
}

function Loading({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("lg:hidden", className)}>
      {children}
    </div>
  );
}

/** Tab strip + search row placeholder (Sales / Inventory chrome) shown while a whole tab route streams in. */
export function MobileListScreenSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="min-h-full bg-surface">
      <div className="flex h-14 items-center gap-6 border-b border-border px-ios-inset">
        {[64, 64, 56, 64].map((w, index) => <Bar key={index} w={w} h={16} />)}
      </div>
      <div className="flex gap-2 p-ios-inset">
        <Bar h={46} r={12} className="min-w-0 flex-1" />
        <Bar w={46} h={46} r={999} />
        <Bar w={46} h={46} r={999} />
      </div>
      <div className="border-t border-border">
        <MobileDocumentRowsSkeleton rows={rows} />
      </div>
    </Loading>
  );
}

/** NativeInvoiceHistorySkeleton rows (day header + document rows). */
function MobileDocumentRowsSkeleton({ rows }: { rows: number }) {
  return (
    <>
      <div className="flex items-center justify-between px-ios-inset py-3">
        <Bar w={90} h={12} r={4} />
        <Bar w={110} h={12} r={4} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn("space-y-2.5 px-ios-inset py-3.5", index < rows - 1 && "border-b border-border")}>
          <div className="flex items-center justify-between gap-4">
            <Bar w={140} h={16} r={4} />
            <Bar w={80} h={16} r={4} />
          </div>
          <Bar w={180} h={13} r={4} />
          <Bar h={11} r={4} />
          <Bar w={120} h={10} r={4} />
        </div>
      ))}
    </>
  );
}

/** Invoice / quote / return list body (NativeInvoiceHistorySkeleton). */
export function MobileDocumentListSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="-mx-ios-inset bg-surface">
      <MobileDocumentRowsSkeleton rows={rows} />
    </Loading>
  );
}

/** Product catalog body (NativeInventoryProductBrowseSkeleton). */
export function MobileProductListSkeleton({ label, rows = 7, className }: { label: string; rows?: number; className?: string }) {
  return (
    <Loading label={label} className={cn("-mx-ios-inset animate-pulse bg-surface", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border px-ios-inset py-[19px]">
          <Bar w={56} h={56} r={14} />
          <div className="min-w-0 flex-1 space-y-[7px]">
            <Pill w={index % 2 === 0 ? 172 : 142} h={14} className="max-w-full" />
            <Pill w={92} h={11} />
            <Pill w={116} h={11} />
          </div>
          <div className="flex flex-col items-end gap-3 pl-2">
            <Pill w={62} h={13} />
            <Pill w={42} h={12} />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** POS product search results (POSProductSearchSkeletonList). */
export function MobilePosSearchSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="animate-pulse">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="relative flex min-h-[104px] items-center gap-2.5 px-3.5">
          <Bar w={40} h={40} r={10} />
          <div className="min-w-0 flex-1 space-y-[7px]">
            <Pill w={index % 2 === 0 ? 190 : 158} h={14} className="max-w-full" />
            <Pill w={104} h={11} />
            <Pill w={76} h={11} />
          </div>
          <div className="flex w-[122px] shrink-0 flex-col items-end gap-3">
            <Pill w={62} h={13} />
            <Bar w={38} h={30} r={9} />
          </div>
          <span className="absolute bottom-0 left-16 right-0 h-px bg-border" aria-hidden="true" />
        </div>
      ))}
    </Loading>
  );
}

/** Overview summary card (DashboardSummarySkeletonView) under a large-title placeholder. */
export function MobileOverviewSkeleton({ label }: { label: string }) {
  const tertiaryPill = (w: number | undefined, h: number, className?: string) => (
    <span
      aria-hidden="true"
      className={cn("block shrink-0 rounded-full", tertiaryFill, w == null && "w-full", className)}
      style={{ width: w, height: h }}
    />
  );
  return (
    <Loading label={label} className="min-h-full bg-canvas">
      <div className="flex min-h-[52px] items-center justify-between px-ios-inset pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Bar w={190} h={34} r={8} />
        <span className="size-11 rounded-full bg-surface" aria-hidden="true" />
      </div>
      <div className="space-y-ios-section px-ios-inset pb-6 pt-2">
        <section className="space-y-2.5 rounded-[22px] bg-surface px-ios-inset py-3">
          {tertiaryPill(210, 24)}
          <span className={cn("block h-[42px] w-full rounded-[22px]", tertiaryFill)} aria-hidden="true" />
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="min-h-[88px] space-y-1.5 rounded-[18px] bg-white px-3 py-2.5 shadow-[0_1px_4px_rgb(0_0_0/0.06)] dark:bg-black dark:shadow-none">
                <div className="flex items-center gap-1.5">
                  <span className={cn("size-[17px] shrink-0 rounded-full", tertiaryFill)} aria-hidden="true" />
                  {tertiaryPill(index === 1 ? 98 : 112, 12, "max-w-full")}
                </div>
                {tertiaryPill(index === 3 ? 124 : 82, 22, "max-w-full")}
                {tertiaryPill(index === 1 ? 58 : 72, 13)}
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-[22px] bg-surface px-ios-inset py-[11px]">
          <Bar w={132} h={18} className="my-0.5" />
          <div className="mt-2.5 grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex min-h-[74px] flex-col items-center gap-1.5">
                <Bar w={50} h={50} r={999} />
                <Bar w={52} h={12} r={4} className="my-[3px]" />
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-surface p-3.5">
          <Bar w={150} h={18} />
          <div className="mt-1">
            {[0, 1, 2].map((index) => (
              <div key={index} className={cn("flex items-center gap-3 py-[13px]", index < 2 && "border-b border-border")}>
                <Bar w={38} h={38} r={12} />
                <div className="min-w-0 flex-1 space-y-[7px]">
                  <Bar w={150} h={14} className="max-w-full" />
                  <Bar w={108} h={11} r={4} />
                </div>
                <Bar w={64} h={13} r={4} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </Loading>
  );
}

const card = "rounded-2xl bg-surface p-4";
const divider = <span className="block h-px w-full bg-black/[0.056] dark:bg-white/[0.056]" aria-hidden="true" />;

/** Invoice detail (LumaDocumentDetailSkeleton) with the detail navigation bar. */
export function MobileDocumentDetailSkeleton({ label }: { label: string }) {
  const circle = "grid size-11 shrink-0 rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] dark:border-white/10";
  return (
    <Loading label={label} className="min-h-full bg-canvas">
      <div className="flex items-center gap-3 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <span className={circle} aria-hidden="true" />
        <span className="flex flex-1 justify-center"><Bar w={120} h={17} /></span>
        <span className={circle} aria-hidden="true" />
      </div>
      <div className="space-y-ios-section px-ios-inset pb-6 pt-4">
        <section className={cn(card, "space-y-3.5")}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Bar w={172} h={25} className="max-w-full" />
              <Bar w={116} h={16} />
              <Bar w={184} h={12} className="max-w-full" />
            </div>
            <div className="flex flex-col items-end gap-[7px]">
              <Bar w={48} h={12} />
              <Bar w={98} h={24} />
              <Bar w={55} h={11} />
            </div>
          </div>
          <div className="flex gap-2">
            <Pill w={78} h={25} />
            <Pill w={88} h={25} />
          </div>
        </section>

        <section className={cn(card, "space-y-1")}>
          <Bar w={138} h={18} className="mb-1" />
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <div className="flex items-center justify-between gap-4 py-[9px]">
                <Bar w={92} h={12} />
                <Bar w={index === 1 ? 132 : 106} h={14} />
              </div>
              {index < 2 && divider}
            </div>
          ))}
        </section>

        <section className={card}>
          <Bar w={148} h={20} className="mb-2.5" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="flex items-start gap-3 py-2.5">
                <Bar w={58} h={58} r={12} />
                <div className="min-w-0 flex-1 space-y-[7px]">
                  <Bar w={142} h={14} className="max-w-full" />
                  <Bar w={104} h={12} />
                  <Bar w={80} h={10} />
                </div>
                <Bar w={58} h={14} />
              </div>
              {index < 3 && <div className="pl-[70px]">{divider}</div>}
            </div>
          ))}
        </section>

        <section className={cn(card, "space-y-[13px]")}>
          <Bar w={104} h={18} className="mb-0.5" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Bar w={94} h={12} />
              <Bar w={82} h={14} />
            </div>
          ))}
          {divider}
          <div className="flex items-center justify-between gap-4">
            <Bar w={66} h={16} />
            <Bar w={104} h={21} />
          </div>
        </section>

        <section className={cn(card, "space-y-3")}>
          <Bar w={132} h={18} />
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center justify-between gap-4 py-[5px]">
              <div className="space-y-[7px]">
                <Bar w={index === 1 ? 146 : 120} h={13} />
                <Bar w={84} h={10} />
              </div>
              <Bar w={62} h={13} />
            </div>
          ))}
        </section>
      </div>
    </Loading>
  );
}
