import { getTranslations } from "next-intl/server";
import { GroupTabs } from "@/components/group-tabs";
import { Section } from "@/components/ui/section";
import { Text } from "@/components/ui/text";
import { getServiceDashboard, getServiceFormOptions } from "@/lib/data/services";
import { Routes } from "@/lib/routes";
import { ProjectQuickCreate } from "../projects/project-widgets";
import {
  ServiceJobQuickCreate,
  ServiceJobsTable,
  ServiceProjectsTable,
  WarrantyClaimQuickCreate,
  WarrantyClaimsTable,
} from "./service-widgets";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "projects", labelKey: "services.tabs.projects" },
  { tab: "jobs", labelKey: "services.tabs.jobs" },
  { tab: "warranty", labelKey: "services.tabs.warranty" },
];

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [t, params, dashboard, options] = await Promise.all([
    getTranslations(),
    searchParams,
    getServiceDashboard(),
    getServiceFormOptions(),
  ]);
  const tab = params.tab ?? "projects";

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-5 border-b border-border bg-surface sm:-mx-6 sm:-mt-6">
        <div className="flex min-h-13 items-center px-4 pt-2.5 sm:px-6">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("services.title")} />
        </div>
        <div className="px-4 pb-1.5 sm:px-6">
          <GroupTabs
            base={Routes.Services}
            items={TABS.map((item) => ({
              ...item,
              count: item.tab === "projects"
                ? dashboard.projects.length
                : item.tab === "jobs"
                  ? dashboard.metrics.openJobs
                  : dashboard.metrics.openClaims,
            }))}
          />
        </div>
      </div>

      {tab === "jobs" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text variant="muted" size="sm" text={t("services.summary.openJobs", { count: dashboard.metrics.openJobs })} />
            <ServiceJobQuickCreate projects={options.projectOptions} assignees={options.assigneeOptions} />
          </div>
          {dashboard.jobs.length > 0
            ? <ServiceJobsTable rows={dashboard.jobs} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.jobs.empty")} /></Section>}
        </div>
      ) : tab === "warranty" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text variant="muted" size="sm" text={t("services.summary.openClaims", { count: dashboard.metrics.openClaims })} />
            <WarrantyClaimQuickCreate projects={options.projectOptions} />
          </div>
          {dashboard.claims.length > 0
            ? <WarrantyClaimsTable rows={dashboard.claims} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.warranty.empty")} /></Section>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text variant="muted" size="sm" text={t("services.summary.activeProjects", { count: dashboard.metrics.activeProjects })} />
            <ProjectQuickCreate customers={options.customerOptions} serviceMode />
          </div>
          {dashboard.projects.length > 0
            ? <ServiceProjectsTable rows={dashboard.projects} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.projects.empty")} /></Section>}
        </div>
      )}
    </div>
  );
}
