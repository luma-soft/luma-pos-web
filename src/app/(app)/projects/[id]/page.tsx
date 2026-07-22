import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { Section } from "@/components/ui/section";
import { Text } from "@/components/ui/text";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";
import {
  InstalledAssetQuickCreate,
  ServiceChecklistEditor,
  ServiceJobEdit,
  ServiceJobQuickCreate,
  ServiceJobStatusAction,
  ServiceMaterialEditor,
  ServiceMaterialStockSync,
  ServiceMaterialReservation,
  ServiceCostEditor,
  ServiceHandoverEditor,
  ServiceMaintenanceEditor,
  WarrantyClaimQuickCreate,
  WarrantyClaimStatusAction,
} from "../../services/service-widgets";
import { ProjectEdit } from "../project-widgets";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const detail = await getProjectDetail(id);
  if (!detail) notFound();
  const { project, orders, jobs, assets, claims, materials, statusLogs, costEntries, profitability, plannedMaterialCost, handoverDocuments, maintenancePlans } = detail;
  const serviceOptions = project.serviceType ? await getServiceFormOptions() : null;

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-[58px] px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <Link href={`${Routes.Partners}?tab=projects`} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-bold">{project.name}</h1>
          <p className="text-xs text-slate-500">{project.customerName ?? t("projects.noCustomer")}</p>
        </div>
        {serviceOptions && <div className="ml-auto"><ProjectEdit project={project} customers={serviceOptions.customerOptions} /></div>}
        {project.serviceType && (
          <Link href={Routes.projectQuote({ projectId: project.id, projectName: project.name, customerId: project.customerId })} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white hover:brightness-110">
            <FilePlus2 className="h-4 w-4" />
            {t("services.projects.createQuote")}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4 mb-5">
        {project.serviceType ? (
          <>
            <Metric label={t("services.tabs.jobs")} value={String(jobs.length)} />
            <Metric label={t("services.fields.progress")} value={`${project.progressPercent}%`} />
            <Metric label={t("services.fields.assets")} value={String(assets.length)} />
            <Metric label={t("services.tabs.warranty")} value={String(claims.filter((claim) => claim.status !== "closed" && claim.status !== "void").length)} danger={claims.some((claim) => claim.priority === "urgent" && claim.status !== "closed")} />
          </>
        ) : (
          <>
            <Metric label={t("projects.cols.orders")} value={String(project.orderCount)} />
            <Metric label={t("projects.cols.value")} value={formatCurrency(Number(project.totalValue))} />
            <Metric label={t("orders.cols.remaining")} value={formatCurrency(Number(project.remaining))} danger={Number(project.remaining) > 0} />
            <Metric label={t("orders.cols.status")} value={t(`projects.status.${project.status}` as never)} />
          </>
        )}
      </div>

      {project.serviceType && serviceOptions && (
        <div className="mb-5 space-y-4">
          <Section
            title={t("services.documents.title")}
            description={t("services.documents.summary", { count: handoverDocuments.length })}
            action={<ServiceHandoverEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} />}
          >
            {handoverDocuments.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.documents.empty")} />
            ) : (
              <div className="space-y-3">
                {handoverDocuments.map((document) => (
                  <div key={document.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft pb-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <Text as="div" weight="semibold" size="sm" text={`${t(`services.documents.${document.type}` as never)} · ${document.title}`} />
                      <Text as="div" variant="muted" size="xs" text={`${t(`services.documents.status.${document.status}` as never)}${document.signedBy ? ` · ${document.signedBy}` : ""}${document.signedAt ? ` · ${document.signedAt}` : ""}`} />
                      {document.content && <Text as="p" size="sm" variant="muted" className="mt-1 whitespace-pre-wrap" text={document.content} />}
                      {document.photoUrls.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{document.photoUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary-600 hover:underline">{t("services.documents.photoLink")}</a>)}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/projects/${project.id}/documents/${document.id}/print`} className="text-xs font-semibold text-primary-600 hover:underline">{t("services.documents.print")}</Link>
                      <ServiceHandoverEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} initial={document} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("services.maintenance.title")}
            description={t("services.maintenance.summary", { count: maintenancePlans.filter((plan) => plan.isActive).length })}
            action={<ServiceMaintenanceEditor projectId={project.id} assets={assets.map((asset) => ({ id: asset.id, name: asset.name, serialNumber: asset.serialNumber }))} staff={serviceOptions.assigneeOptions} />}
          >
            {maintenancePlans.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.maintenance.empty")} />
            ) : (
              <div className="space-y-2">
                {maintenancePlans.map((plan) => (
                  <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
                    <div>
                      <Text size="sm" weight="medium" text={plan.title} />
                      <Text size="xs" variant="muted" text={`${plan.assetName ?? t("services.assets.noProduct")} · ${t("services.maintenance.nextDueOn")}: ${plan.nextDueOn}${plan.assignedToName ? ` · ${plan.assignedToName}` : ""}`} />
                    </div>
                    <ServiceMaintenanceEditor projectId={project.id} assets={assets.map((asset) => ({ id: asset.id, name: asset.name, serialNumber: asset.serialNumber }))} staff={serviceOptions.assigneeOptions} initial={plan} />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("services.costs.title")}
            description={t("services.costs.summary", { count: costEntries.length })}
            action={<ServiceCostEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} staff={serviceOptions.assigneeOptions} />}
          >
            {profitability && (
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
                <CostMetric label={t("services.costs.revenue")} value={profitability.revenue} />
                <CostMetric label={t("services.costs.plannedMaterialCost")} value={plannedMaterialCost} />
                <CostMetric label={t("services.costs.materialCost")} value={profitability.materialCost} />
                <CostMetric label={t("services.costs.laborCost")} value={profitability.laborCost} />
                <CostMetric label={t("services.costs.otherCost")} value={profitability.otherCost} />
                <CostMetric label={t("services.costs.grossProfit")} value={profitability.grossProfit} tone={profitability.grossProfit >= 0 ? "text-ok" : "text-er"} />
              </div>
            )}
            {costEntries.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.costs.empty")} />
            ) : (
              <div className="space-y-2">
                {costEntries.map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
                    <div className="min-w-0">
                      <Text size="sm" weight="medium" text={`${t(`services.costs.${entry.type}` as never)} · ${entry.description}`} />
                      <Text size="xs" variant="muted" text={`${entry.incurredOn}${entry.staffName ? ` · ${entry.staffName}` : ""}${entry.note ? ` · ${entry.note}` : ""}`} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Text size="sm" weight="semibold" text={formatCurrency(Number(entry.amount))} />
                      <ServiceCostEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} staff={serviceOptions.assigneeOptions} initial={entry} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("services.tabs.jobs")}
            description={t("services.summary.openJobs", { count: jobs.filter((job) => job.status !== "completed" && job.status !== "cancelled").length })}
            action={<ServiceJobQuickCreate projects={[{ id: project.id, name: project.name, serviceType: project.serviceType }]} assignees={serviceOptions.assigneeOptions} />}
          >
            {jobs.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.jobs.empty")} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {jobs.map((job) => (
                  <div key={job.id} className="rounded-card border border-border-soft bg-surface-2 p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <Text as="div" weight="semibold" text={`${job.code} · ${job.title}`} />
                        <Text as="div" variant="muted" size="xs" className="mt-0.5" text={`${t(`services.types.${job.serviceType}` as never)} · ${job.assignedToName ?? t("services.fields.unassigned")}`} />
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ServiceJobEdit job={job} projectType={project.serviceType ?? job.serviceType} assignees={serviceOptions.assigneeOptions} orders={orders.map((order) => ({ id: order.id, code: order.code, status: order.status }))} />
                        <ServiceJobStatusAction jobId={job.id} status={job.status} />
                      </div>
                    </div>
                    {job.description && <Text as="p" size="sm" variant="muted" className="mb-3" text={job.description} />}
                    {(job.quoteOrderId || job.materialOrderId) && (
                      <div className="mb-3 flex flex-wrap gap-3 text-xs">
                        {job.quoteOrderId && <Link href={Routes.salesOrder(job.quoteOrderId, "quote")} className="font-semibold text-primary-600 hover:underline">{t("services.fields.quote")}</Link>}
                        {job.materialOrderId && <Link href={Routes.salesOrder(job.materialOrderId, "completed")} className="font-semibold text-primary-600 hover:underline">{t("services.fields.materialOrder")}</Link>}
                      </div>
                    )}
                    <ServiceChecklistEditor jobId={job.id} checklist={job.checklist} />
                    {statusLogs.some((log) => log.jobId === job.id) && (
                      <div className="mt-3 border-t border-border-soft pt-3">
                        <Text as="div" weight="semibold" size="xs" className="mb-2" tx="services.fields.history" />
                        <div className="space-y-2">
                          {statusLogs.filter((log) => log.jobId === job.id).slice(0, 5).map((log) => (
                            <div key={log.id} className="text-xs text-slate-500">
                              <span className="font-medium text-slate-700 dark:text-slate-200">{t(`services.jobStatuses.${log.toStatus}` as never)}</span>
                              {` · ${formatDate(log.createdAt)}${log.createdByName ? ` · ${log.createdByName}` : ""}`}
                              {log.note && <div className="mt-0.5">{log.note}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("services.fields.assets")}
            description={t("services.summary.assets", { count: assets.length })}
            action={<InstalledAssetQuickCreate projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} products={serviceOptions.productOptions} />}
          >
            {assets.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.assets.empty")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2 pr-3">{t("services.fields.asset")}</th><th className="px-3 py-2">{t("services.fields.serialNumber")}</th><th className="px-3 py-2">{t("services.fields.location")}</th><th className="px-3 py-2">{t("services.fields.macAddress")}</th><th className="px-3 py-2">{t("orders.cols.status")}</th><th className="py-2 pl-3">{t("services.tabs.warranty")}</th><th /></tr></thead>
                  <tbody className="divide-y divide-border-soft">
                    {assets.map((asset) => <tr key={asset.id}><td className="py-2 pr-3 font-medium">{asset.name}<div className="text-xs font-normal text-slate-500">{[asset.brand, asset.model].filter(Boolean).join(" · ")}</div></td><td className="px-3 py-2 font-mono text-xs">{asset.serialNumber ?? "—"}</td><td className="px-3 py-2">{asset.locationLabel ?? "—"}</td><td className="px-3 py-2 font-mono text-xs">{asset.macAddress ?? "—"}</td><td className="px-3 py-2">{t(`services.assetStatuses.${asset.status}` as never)}</td><td className="py-2 pl-3">{asset.customerWarrantyEndsOn ? formatDate(asset.customerWarrantyEndsOn) : "—"}</td><td className="pl-3 text-right"><InstalledAssetQuickCreate projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} products={serviceOptions.productOptions} initial={asset} /></td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title={t("services.tabs.warranty")}
            description={t("services.summary.openClaims", { count: claims.filter((claim) => claim.status !== "closed" && claim.status !== "void").length })}
            action={<WarrantyClaimQuickCreate
              projects={[{ id: project.id, name: project.name, serviceType: project.serviceType }]}
              jobs={jobs.map((job) => ({ id: job.id, projectId: project.id, code: job.code, title: job.title }))}
              assets={assets.map((asset) => ({ id: asset.id, projectId: project.id, jobId: asset.jobId, name: asset.name, serialNumber: asset.serialNumber }))}
            />}
          >
            {claims.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.warranty.empty")} />
            ) : (
              <div className="space-y-2">
                {claims.map((claim) => (
                  <div key={claim.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft pb-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <Text as="div" weight="semibold" size="sm" text={`${claim.code} · ${claim.title}`} />
                      <Text as="div" variant="muted" size="xs" text={`${formatDate(claim.reportedAt)}${claim.assetName ? ` · ${claim.assetName}` : ""}`} />
                      {claim.description && <Text as="p" size="xs" variant="muted" className="mt-1" text={claim.description} />}
                      {(Number(claim.laborCharge) > 0 || Number(claim.materialCharge) > 0) && (
                        <Text as="div" size="xs" className="mt-1" text={`${t("services.fields.cost")}: ${formatCurrency(Number(claim.laborCharge) + Number(claim.materialCharge))}`} />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <WarrantyClaimQuickCreate
                        projects={[{ id: project.id, name: project.name, serviceType: project.serviceType }]}
                        jobs={jobs.map((job) => ({ id: job.id, projectId: project.id, code: job.code, title: job.title }))}
                        assets={assets.map((asset) => ({ id: asset.id, projectId: project.id, jobId: asset.jobId, name: asset.name, serialNumber: asset.serialNumber }))}
                        initial={claim}
                      />
                      <WarrantyClaimStatusAction claimId={claim.id} status={claim.status} diagnosis={claim.diagnosis} resolution={claim.resolution} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("services.materials.title")}
            description={t("services.materials.summary", { count: materials.length })}
            action={<ServiceMaterialEditor jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} products={serviceOptions.productOptions} />}
          >
            {materials.length === 0 ? (
              <Text variant="muted" size="sm" text={t("services.materials.empty")} />
            ) : (
              <div className="space-y-2">
                {materials.map((material) => (
                  <div key={material.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
                    <div>
                      <Text size="sm" weight="medium" text={`${material.sku} · ${material.productName}`} />
                      <Text size="xs" variant="muted" text={`${material.jobCode} · ${material.jobTitle}`} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Text size="sm" text={`${t("services.materials.used")}: ${Number(material.usedQuantity)} / ${Number(material.plannedQuantity)} ${material.unitName}`} />
                      <ServiceMaterialReservation material={material} warehouses={serviceOptions.warehouseOptions} />
                      <ServiceMaterialStockSync material={material} warehouses={serviceOptions.warehouseOptions} />
                      <ServiceMaterialEditor
                        jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))}
                        products={serviceOptions.productOptions}
                        initial={material}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-3">
          <Info label={t("projects.cols.name")} value={project.name} />
          <Info label={t("orders.cols.customer")} value={project.customerName ?? "—"} />
          {project.serviceType && <Info label={t("services.fields.type")} value={t(`services.types.${project.serviceType}` as never)} />}
          {project.serviceStage && <Info label={t("services.fields.stage")} value={t(`services.stages.${project.serviceStage}` as never)} />}
          <Info label={t("customers.fields.address")} value={project.address ?? "—"} />
          {project.siteContactName && <Info label={t("services.fields.siteContactName")} value={`${project.siteContactName}${project.siteContactPhone ? ` · ${project.siteContactPhone}` : ""}`} />}
          {project.targetEndsOn && <Info label={t("services.fields.targetEndsOn")} value={formatDate(project.targetEndsOn)} />}
          <Info label={t("customers.fields.note")} value={project.note ?? "—"} />
          <Info label={t("orders.cols.date")} value={formatDate(project.createdAt)} />
        </div>

        <div className="bg-surface border border-border rounded-card overflow-x-auto">
          <div className="px-4 py-3 border-b border-border font-semibold text-sm">{t("projects.relatedOrders")}</div>
          {orders.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-400 text-center">{t("orders.empty")}</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.code")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.customer")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.status")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.total")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.remaining")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {orders.map((order) => {
                  const remaining = Number(order.total) - Number(order.amountPaid);
                  return (
                    <tr key={order.id}>
                      <td className="px-4 py-3"><Link href={Routes.salesOrder(order.id, order.status)} className="font-semibold text-primary-600 hover:underline">{order.code}</Link></td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
                      <td className="px-4 py-3">{order.customerName ?? t("orders.walkIn")}</td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5"><OrderStatusBadge status={order.status} /><PaymentStatusBadge status={order.paymentStatus} /></div></td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(order.total))}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-er">{remaining > 0 ? formatCurrency(remaining) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-card p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${danger ? "text-er" : ""}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function CostMetric({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${tone}`}>{formatCurrency(value)}</div>
    </div>
  );
}
