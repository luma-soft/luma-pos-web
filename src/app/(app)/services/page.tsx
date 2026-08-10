import { getTranslations } from "next-intl/server";
import { GroupTabs } from "@/components/group-tabs";
import { Pagination } from "@/components/pagination";
import { Section } from "@/components/ui/section";
import { Text } from "@/components/ui/text";
import { getServiceDashboard, getServiceFormOptions } from "@/lib/data/services";
import { Routes } from "@/lib/routes";
import { ProjectQuickCreate } from "../projects/project-widgets";
import {
  ServiceJobQuickCreate,
  ServiceJobsTable,
  ServiceProjectsTable,
  ServiceDashboardFilters,
  WarrantyClaimQuickCreate,
  WarrantyClaimsTable,
} from "./service-widgets";
import { ProductsTab } from "../inventory/tabs/products";
import { parsePageSize } from "@/lib/pagination";
import { getManagerServiceCustomerRequests } from "@/lib/data/service-customer-requests";
import { CustomerRequestsManager } from "./customer-requests-manager";
import { requireManager } from "@/lib/actions/common";
import {
  getServiceDispatchPage,
  getServiceManagerReport,
  parseServiceDispatchQuery,
  parseServiceReportQuery,
} from "@/lib/services/dispatch-reporting";
import { ServiceDispatchPanel, ServiceReportPanel } from "./service-dispatch-panels";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "projects", labelKey: "services.tabs.projects" },
  { tab: "jobs", labelKey: "services.tabs.jobs" },
  { tab: "dispatch", labelKey: "services.tabs.dispatch" },
  { tab: "reporting", labelKey: "services.tabs.reporting" },
  { tab: "warranty", labelKey: "services.tabs.warranty" },
  { tab: "requests", labelKey: "services.tabs.requests" },
  { tab: "camera-materials", labelKey: "inventory.cameraMaterials" },
];

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [t, params, context] = await Promise.all([getTranslations(), searchParams, requireStoreContext()]);
  const tab = params.tab ?? "projects";
  const managerGate = ["dispatch", "reporting"].includes(tab)
    ? await requireManager()
    : null;
  const [dashboard, options, customerRequests] = await Promise.all([
    getServiceDashboard(context.storeId),
    getServiceFormOptions(context.storeId),
    getManagerServiceCustomerRequests(),
  ]);
  const queryParams = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  let dispatchData = null;
  let reportData = null;
  if (managerGate?.ok && tab === "dispatch") {
    try {
      dispatchData = await getServiceDispatchPage(parseServiceDispatchQuery(queryParams));
    } catch {
      dispatchData = await getServiceDispatchPage(
        parseServiceDispatchQuery(new URLSearchParams({ scope: "week" })),
      );
    }
  }
  if (managerGate?.ok && tab === "reporting") {
    try {
      reportData = await getServiceManagerReport(parseServiceReportQuery(queryParams));
    } catch {
      reportData = await getServiceManagerReport(parseServiceReportQuery(new URLSearchParams()));
    }
  }
  const serviceType = params.type ?? "";
  const status = params.status ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = parsePageSize(params.size);
  const projectRows = dashboard.projects.filter((project) =>
    (!serviceType || project.serviceType === serviceType) && (!status || project.serviceStage === status)
  );
  const pagedProjectRows = projectRows.slice((page - 1) * pageSize, page * pageSize);
  const projectPageCount = Math.max(1, Math.ceil(projectRows.length / pageSize));
  const jobRows = dashboard.jobs.filter((job) =>
    (!serviceType || job.serviceType === serviceType) && (!status || job.status === status)
  );
  const claimRows = dashboard.claims.filter((claim) =>
    (!serviceType || claim.serviceType === serviceType) && (!status || claim.status === status)
  );

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
                  : item.tab === "warranty"
                  ? dashboard.metrics.openClaims
                  : item.tab === "requests" && customerRequests.allowed
                    ? customerRequests.rows.filter((request) => !["closed", "void"].includes(request.status)).length
                    : undefined,
            }))}
          />
        </div>
      </div>

      {tab === "dispatch" ? (
        managerGate?.ok && dispatchData
          ? <ServiceDispatchPanel data={dispatchData} technicians={options.assigneeOptions} params={params} />
          : <Section collapsible={false}><Text variant="muted" size="sm" text={t("errors.forbidden")} /></Section>
      ) : tab === "reporting" ? (
        managerGate?.ok && reportData
          ? <ServiceReportPanel data={reportData} />
          : <Section collapsible={false}><Text variant="muted" size="sm" text={t("errors.forbidden")} /></Section>
      ) : tab === "camera-materials" ? (
        <ProductsTab searchParams={{ ...params, cameraMaterials: "1" }} />
      ) : tab === "jobs" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Text variant="muted" size="sm" text={t("services.summary.openJobs", { count: jobRows.filter((job) => job.status !== "completed" && job.status !== "cancelled").length })} />
              <ServiceDashboardFilters tab={tab} serviceType={serviceType} status={status} />
            </div>
            <ServiceJobQuickCreate projects={options.projectOptions} assignees={options.assigneeOptions} />
          </div>
          {jobRows.length > 0
            ? <ServiceJobsTable rows={jobRows} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.jobs.empty")} /></Section>}
        </div>
      ) : tab === "requests" ? (
        customerRequests.allowed ? (
          <CustomerRequestsManager
            rows={customerRequests.rows}
            jobs={options.jobOptions}
          />
        ) : (
          <Section collapsible={false}><Text variant="muted" size="sm" text={t("errors.forbidden")} /></Section>
        )
      ) : tab === "warranty" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Text variant="muted" size="sm" text={t("services.summary.openClaims", { count: claimRows.filter((claim) => claim.status !== "closed" && claim.status !== "void").length })} />
              <ServiceDashboardFilters tab={tab} serviceType={serviceType} status={status} />
            </div>
            <WarrantyClaimQuickCreate projects={options.projectOptions} jobs={options.jobOptions} assets={options.assetOptions} />
          </div>
          {claimRows.length > 0
            ? <WarrantyClaimsTable rows={claimRows} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.warranty.empty")} /></Section>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Text variant="muted" size="sm" text={t("services.summary.activeProjects", { count: projectRows.filter((project) => project.serviceStage !== "completed" && project.serviceStage !== "cancelled").length })} />
              <ServiceDashboardFilters tab={tab} serviceType={serviceType} status={status} />
            </div>
            <ProjectQuickCreate customers={options.customerOptions} serviceMode />
          </div>
          {projectRows.length > 0
            ? <ServiceProjectsTable rows={pagedProjectRows} customers={options.customerOptions} />
            : <Section collapsible={false}><Text variant="muted" size="sm" text={t("services.projects.empty")} /></Section>}
          <Pagination page={page} pageCount={projectPageCount} total={projectRows.length} pageSize={pageSize} unitLabel={t("projects.unitLabel")} />
        </div>
      )}
    </div>
  );
}
