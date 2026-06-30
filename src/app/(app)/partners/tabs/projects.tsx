import { getTranslations } from "next-intl/server";
import { asc, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getProjectRows } from "@/lib/data/projects";
import { ProjectQuickCreate } from "../../projects/project-widgets";
import { ProjectsTable } from "./projects-table";

export async function ProjectsTab() {
  const t = await getTranslations();
  const [rows, customerOptions] = await Promise.all([
    getProjectRows(),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name)).limit(300),
  ]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="text-sm text-slate-500">{t("projects.total", { total: rows.length })}</span>
        <ProjectQuickCreate customers={customerOptions} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("projects.empty")}</p>
          <p className="text-sm mt-1">{t("projects.emptyHint")}</p>
        </div>
      ) : (
        <ProjectsTable rows={rows} customers={customerOptions} />
      )}
    </>
  );
}
