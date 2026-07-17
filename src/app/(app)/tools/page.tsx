import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";

export default async function ToolsPage() {
  const t = await getTranslations();

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col lg:min-h-dvh">
      <PageHeader
        title={t("nav.tools")}
        badge={(
          <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/50 dark:text-primary-400">
            Tile calculator
          </span>
        )}
      />
      <iframe
        src="/tools/tile-calculator.html"
        title="Công cụ tính gạch ốp lát"
        allow="clipboard-write"
        className="min-h-[calc(100dvh-7.625rem)] w-full flex-1 border-0 bg-canvas lg:min-h-[calc(100dvh-3.625rem)]"
      />
    </div>
  );
}
