import { getAllLabelTemplates } from "@/lib/labels/template";
import { LabelSettingsForm } from "./label-settings-form";

export const dynamic = "force-dynamic";

export default async function LabelSettingsPage() {
  const templates = await getAllLabelTemplates();
  return <LabelSettingsForm templates={templates} />;
}
