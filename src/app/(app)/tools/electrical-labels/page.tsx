import { getTranslations } from "next-intl/server";
import { ElectricalLabelsClient } from "./electrical-labels-client";
import { ToolPageHeader } from "../tool-page-header";

export default async function ElectricalLabelsPage() {
  const [t, toolsT] = await Promise.all([
    getTranslations("electricalLabels"),
    getTranslations("toolsCenter"),
  ]);

  return (
    <div className="min-h-full bg-canvas">
      <ToolPageHeader
        eyebrow={toolsT("breadcrumbs.printing")}
        title={t("title")}
        description={t("description")}
      />
      <ElectricalLabelsClient />
    </div>
  );
}
