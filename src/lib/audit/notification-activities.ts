import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  profiles,
  projects,
  serviceJobs,
  serviceJobTradeRecords,
} from "@/db/schema";
import {
  countAuditLogs,
  getAuditLogs,
  type AuditLogFilters,
} from "@/lib/audit";
import { Routes } from "@/lib/routes";
import {
  activityObject,
  activityText,
  type ActivityRecord,
  type NotificationActivity,
} from "./activity-presentation";

async function presentNotificationActivities(
  storeId: string,
  rows: Awaited<ReturnType<typeof getAuditLogs>>,
): Promise<NotificationActivity[]> {
  const actorIds = [
    ...new Set(
      rows
        .filter((row) => !row.actorNameSnapshot?.trim())
        .flatMap((row) => (row.actorId ? [row.actorId] : [])),
    ),
  ];
  const productIds = [
    ...new Set(
      rows.flatMap((row) =>
        ["product", "product_price"].includes(row.entityType) && row.entityId
          ? [row.entityId]
          : [],
      ),
    ),
  ];
  const projectIds = [
    ...new Set(
      rows.flatMap((row) => {
        const id = ["project", "service_project"].includes(row.entityType)
          ? row.entityId
          : (activityText(activityObject(row.metadata).projectId) ??
            activityText(activityObject(row.after).projectId));
        return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
          ? [id]
          : [];
      }),
    ),
  ];
  const jobIds = new Set<string>();
  const tradeRecordIds: string[] = [];
  for (const row of rows) {
    if (row.entityType === "service_job" && row.entityId)
      jobIds.add(row.entityId);
    if (row.entityType === "service_job_trade_record" && row.entityId)
      tradeRecordIds.push(row.entityId);
    if (row.entityType.startsWith("service_")) {
      const jobId = activityText(activityObject(row.metadata).jobId);
      if (jobId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId))
        jobIds.add(jobId);
    }
  }
  const jobConditions: SQL[] = [];
  if (jobIds.size) jobConditions.push(inArray(serviceJobs.id, [...jobIds]));
  if (tradeRecordIds.length)
    jobConditions.push(inArray(serviceJobTradeRecords.id, tradeRecordIds));

  const [actors, productRows, jobs, projectRows] = await Promise.all([
    actorIds.length
      ? db
          .select({ id: profiles.id, name: profiles.fullName })
          .from(profiles)
          .where(
            and(eq(profiles.storeId, storeId), inArray(profiles.id, actorIds)),
          )
      : [],
    productIds.length
      ? db
          .select({ id: products.id, code: products.sku, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.storeId, storeId),
              inArray(products.id, productIds),
            ),
          )
      : [],
    jobConditions.length
      ? db
          .select({
            id: serviceJobs.id,
            code: serviceJobs.code,
            name: serviceJobs.title,
            projectId: projects.id,
            projectName: projects.name,
            tradeRecordId: serviceJobTradeRecords.id,
          })
          .from(serviceJobs)
          .leftJoin(
            projects,
            and(
              eq(projects.id, serviceJobs.projectId),
              eq(projects.storeId, storeId),
            ),
          )
          .leftJoin(
            serviceJobTradeRecords,
            and(
              eq(serviceJobTradeRecords.jobId, serviceJobs.id),
              eq(serviceJobTradeRecords.storeId, storeId),
            ),
          )
          .where(and(eq(serviceJobs.storeId, storeId), or(...jobConditions)))
      : [],
    projectIds.length
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.storeId, storeId),
              inArray(projects.id, projectIds),
            ),
          )
      : [],
  ]);

  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const entities = new Map<string, ActivityRecord>();
  for (const project of projectRows)
    entities.set(project.id, {
      ...project,
      type: "project",
      code: null,
      href: Routes.project(project.id),
    });
  for (const product of productRows)
    entities.set(product.id, { ...product, type: "product" });
  for (const job of jobs) {
    const record = {
      id: job.id,
      type: "service_job",
      code: job.code,
      name: job.name,
      context: job.projectName,
      href: job.projectId ? Routes.project(job.projectId) : null,
    };
    entities.set(job.id, record);
    if (job.tradeRecordId) entities.set(job.tradeRecordId, record);
  }
  return rows.map((row) => ({
    ...row,
    actorNameSnapshot:
      row.actorNameSnapshot?.trim() ||
      actorNames.get(row.actorId ?? "") ||
      null,
    resolvedEntity:
      entities.get(row.entityId ?? "") ??
      (row.entityType.startsWith("service_")
        ? entities.get(activityText(activityObject(row.metadata).jobId) ?? "")
        : null) ??
      (() => {
        const projectId =
          activityText(activityObject(row.metadata).projectId) ??
          activityText(activityObject(row.after).projectId);
        const project = entities.get(projectId ?? "");
        return project ? { ...project, context: project.name } : null;
      })(),
  }));
}

export async function getNotificationActivities(
  storeId: string,
  userId: string,
): Promise<NotificationActivity[]> {
  const rows = await getAuditLogs({
    storeId,
    notificationUserId: userId,
    limit: 100,
  });
  return presentNotificationActivities(storeId, rows);
}

export async function getNotificationActivityPage(
  storeId: string,
  userId: string,
  page: number,
  pageSize: number,
  extraFilters: Pick<
    AuditLogFilters,
    | "source"
    | "status"
    | "action"
    | "entityType"
    | "actorId"
    | "dateFrom"
    | "dateTo"
  > = {},
) {
  const filters = { ...extraFilters, storeId, notificationUserId: userId };
  const requestedPage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const total = await countAuditLogs(filters);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(requestedPage, pageCount);
  const rows = await getAuditLogs({
    ...filters,
    limit: safePageSize,
    offset: (safePage - 1) * safePageSize,
  });

  return {
    rows: await presentNotificationActivities(storeId, rows),
    total,
    page: safePage,
    pageCount,
    pageSize: safePageSize,
  };
}
