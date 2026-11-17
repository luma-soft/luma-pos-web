"use client";

import { useTranslations } from "next-intl";
import { AdminOperationsPanel } from "@/components/admin/admin-operations-panel";

export function AdminClient() {
  const t = useTranslations("admin");
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-8 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
      </header>
      <AdminOperationsPanel />
    </div>
  );
}
