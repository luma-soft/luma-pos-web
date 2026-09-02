import { getTranslations } from "next-intl/server";
import { Pagination } from "@/components/pagination";
import { Section } from "@/components/ui/section";
import { Text } from "@/components/ui/text";
import { getServiceDashboard, getServiceFormOptions } from "@/lib/data/services";
import { ProjectQuickCreate } from "../projects/project-widgets";
import {
  ServiceDashboardFilters,
  ServiceProjectsTable,
} from "./service-widgets";
import { parsePageSize } from "@/lib/pagination";
import { requireStoreContext } from "@/lib/auth/store-context";
import { requirePageFeature } from "@/lib/tenancy/page-feature";

export const dynamic = "force-dynamic";

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePageFeature("field_services");
  const [t, params, context] = await Promise.all([getTranslations(), searchParams, requireStoreContext()]);
  const [dashboard, options] = await Promise.all([
    getServiceDashboard(context.storeId),
    getServiceFormOptions(context.storeId),
  ]);
  const serviceType = params.type ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = parsePageSize(params.size);
  const projectRows = dashboard.projects.filter((project) =>
    !serviceType || project.serviceType === serviceType
  );
  const pagedProjectRows = projectRows.slice((page - 1) * pageSize, page * pageSize);
  const projectPageCount = Math.max(1, Math.ceil(projectRows.length / pageSize));

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-5 border-b border-border bg-surface sm:-mx-6 sm:-mt-6">
        <div className="flex min-h-14 items-center px-4 sm:px-6">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("services.title")} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Text variant="muted" size="sm" text={t("services.summary.activeProjects", { count: projectRows.filter((project) => project.status !== "done" && project.serviceStage !== "completed" && project.serviceStage !== "cancelled").length })} />
            <ServiceDashboardFilters tab="projects" serviceType={serviceType} status="" />
          </div>
          <ProjectQuickCreate customers={options.customerOptions} serviceMode />
        </div>
        {projectRows.length > 0
          ? <ServiceProjectsTable rows={pagedProjectRows} customers={options.customerOptions} />
          : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.projects.empty")} /></Section>}
        <Pagination page={page} pageCount={projectPageCount} total={projectRows.length} pageSize={pageSize} unitLabel={t("projects.unitLabel")} />
      </div>
    </div>
  );
}
