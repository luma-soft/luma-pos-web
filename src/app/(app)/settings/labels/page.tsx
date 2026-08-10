import { getAllLabelTemplates } from "@/lib/labels/template";
import { LabelSettingsForm } from "./label-settings-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function LabelSettingsPage() {
  const context = await requireStoreContext();
  const templates = await getAllLabelTemplates(context.storeId);
  return <LabelSettingsForm templates={templates} />;
}
