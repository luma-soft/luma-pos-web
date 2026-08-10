import { getAllPrintTemplates, getPrintTemplateStoreInfo } from "@/lib/print/template";
import { PrintSettingsForm } from "./print-settings-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function PrintSettingsPage() {
  const context = await requireStoreContext();
  const [templates, storeDefaults] = await Promise.all([getAllPrintTemplates(context.storeId), getPrintTemplateStoreInfo(context.storeId)]);
  return <PrintSettingsForm templates={templates} storeDefaults={storeDefaults} />;
}
