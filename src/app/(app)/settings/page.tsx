import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Printer, ChevronRight } from "lucide-react";

export default async function SettingsPage() {
  const t = await getTranslations();
  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <h1 className="text-[17px] font-bold">{t("nav.settings")}</h1>
      </div>
      <div className="max-w-2xl bg-surface border border-border rounded-card divide-y divide-border-soft">
        <Link href="/settings/print" className="flex items-center gap-3 p-4 hover:bg-surface-2">
          <div className="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-950/40 grid place-items-center">
            <Printer className="w-4.5 h-4.5 text-primary-600" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{t("printSettings.title")}</div>
            <div className="text-xs text-slate-500">{t("printSettings.settingsDesc")}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </Link>
      </div>
      <p className="text-xs text-slate-400 mt-4 max-w-2xl">{t("settings.moreSoon")}</p>
    </div>
  );
}
