import Link from "next/link";
import { Calculator, Tags } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button-variants";
import { Routes } from "@/lib/routes";
import { ElectricalLabelsClient } from "./electrical-labels-client";

export default async function ElectricalLabelsPage() {
  const t = await getTranslations("electricalLabels");

  return (
    <div className="min-h-dvh bg-canvas">
      <PageHeader
        title={t("title")}
        badge={(
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/50 dark:text-primary-300">
            <Tags className="size-3.5" />
            {t("badge")}
          </span>
        )}
      >
        <Link
          href={Routes.Tools}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Calculator />
          {t("tileCalculator")}
        </Link>
      </PageHeader>
      <ElectricalLabelsClient />
    </div>
  );
}
