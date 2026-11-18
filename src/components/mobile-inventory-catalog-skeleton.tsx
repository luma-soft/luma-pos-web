import { useTranslations } from "next-intl";
import { MobileProductListSkeleton } from "@/components/mobile-skeletons";
import { DesktopTableSkeleton } from "@/components/table-skeleton";

/** A single consistent placeholder for server streaming and IndexedDB restore.
 * No effects or subscriptions; desktop still receives its original table loader.
 * Phones get the segmented control, search row and NativeInventoryProductBrowseSkeleton.
 */
export function MobileInventoryCatalogSkeleton() {
  const t = useTranslations();
  const fill = "bg-black/[0.08] dark:bg-white/[0.08]";
  return (
    <>
      <div className="lg:hidden" aria-hidden="true">
        {/* Same geometry as the loaded segmented control and search row, so nothing jumps. */}
        <div className={`grid h-12 grid-cols-2 gap-1 rounded-full p-1 ${fill}`}>
          <div className="rounded-full bg-surface" />
          <div />
        </div>
        <div className="mt-[18px] flex gap-2">
          <div className={`h-[46px] min-w-0 flex-1 rounded-xl ${fill}`} />
          <div className={`size-[46px] rounded-full ${fill}`} />
          <div className={`size-[46px] rounded-full ${fill}`} />
        </div>
      </div>
      <div className="-mx-ios-inset mt-[18px] border-t border-border lg:hidden">
        <MobileProductListSkeleton label={t("common.loading")} className="mx-0" />
      </div>
      <div className="hidden lg:block" aria-hidden="true">
        <DesktopTableSkeleton cols={8} rows={10} />
      </div>
    </>
  );
}
