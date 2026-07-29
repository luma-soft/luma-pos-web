import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  profiles,
  projects,
  serviceCustomerRequests,
  serviceJobAssignments,
  serviceJobs,
  serviceMaintenanceOccurrences,
  serviceTimeEntries,
  serviceVisits,
} from "@/db/schema";
export {
  parseServiceDispatchQuery,
  parseServiceReportQuery,
  summarizeServiceMetrics,
} from "@/lib/services/dispatch-reporting-domain";
import {
  parseServiceDispatchQuery,
  parseServiceReportQuery,
  summarizeServiceMetrics,
} from "@/lib/services/dispatch-reporting-domain";

function overdueSlaSql(now: Date) {
  return sql<boolean>`exists (
    select 1 from ${serviceCustomerRequests} request
    where request.linked_job_id = ${serviceJobs.id}
      and request.status not in ('closed', 'void')
      and (
        (request.responded_at is null and request.response_due_at < ${now})
        or (request.resolved_at is null and request.resolution_due_at < ${now})
      )
  )`;
}

function overdueMaintenanceSql(today: string) {
  return sql<boolean>`exists (
    select 1 from ${serviceMaintenanceOccurrences} occurrence
    where occurrence.job_id = ${serviceJobs.id}
      and (
        occurrence.status = 'overdue'
        or (occurrence.status = 'scheduled' and occurrence.due_on < ${today})
      )
  )`;
}

function localDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function getServiceDispatchPage(
  query: ReturnType<typeof parseServiceDispatchQuery>,
  now = new Date(),
) {
  const conditions: Array<SQL | undefined> = [
    gte(serviceJobs.scheduledAt, query.from),
    lt(serviceJobs.scheduledAt, query.to),
    query.statuses.length ? inArray(serviceJobs.status, query.statuses) : undefined,
    query.priorities.length ? inArray(serviceJobs.priority, query.priorities) : undefined,
    query.technicianId
      ? or(
        eq(serviceJobs.assignedTo, query.technicianId),
        sql`exists (
          select 1 from ${serviceJobAssignments} assignment
          where assignment.job_id = ${serviceJobs.id}
            and assignment.profile_id = ${query.technicianId}
            and assignment.removed_at is null
        )`,
      )
      : undefined,
    query.unassigned === true ? isNull(serviceJobs.assignedTo) : undefined,
    query.unassigned === false ? sql`${serviceJobs.assignedTo} is not null` : undefined,
    query.slaOverdue === true ? overdueSlaSql(now) : undefined,
    query.slaOverdue === false ? sql`not (${overdueSlaSql(now)})` : undefined,
    query.maintenanceOverdue === true ? overdueMaintenanceSql(localDate(now)) : undefined,
    query.maintenanceOverdue === false
      ? sql`not (${overdueMaintenanceSql(localDate(now))})`
      : undefined,
  ];
  const where = and(...conditions);
  const [rows, totals] = await Promise.all([
    db.select({
      id: serviceJobs.id,
      code: serviceJobs.code,
      projectId: serviceJobs.projectId,
      projectName: projects.name,
      customerName: customers.name,
      address: projects.address,
      title: serviceJobs.title,
      serviceType: serviceJobs.serviceType,
      status: serviceJobs.status,
      priority: serviceJobs.priority,
      assignedTo: serviceJobs.assignedTo,
      assignedToName: profiles.fullName,
      scheduledAt: serviceJobs.scheduledAt,
      updatedAt: serviceJobs.updatedAt,
      slaOverdue: overdueSlaSql(now),
      maintenanceOverdue: overdueMaintenanceSql(localDate(now)),
    }).from(serviceJobs)
      .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .leftJoin(profiles, eq(serviceJobs.assignedTo, profiles.id))
      .where(where)
      .orderBy(asc(serviceJobs.scheduledAt), desc(serviceJobs.priority), asc(serviceJobs.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit),
    db.select({ value: count() }).from(serviceJobs).where(where),
  ]);
  const total = totals[0]?.value ?? 0;
  return {
    rows,
    scope: query.scope,
    page: query.page,
    limit: query.limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / query.limit)),
    range: { from: query.from, to: query.to },
  };
}

export async function getServiceManagerReport(
  query: ReturnType<typeof parseServiceReportQuery>,
  now = new Date(),
) {
  const today = localDate(now);
  const result = await db.execute(sql`
    with cohort as (
      select job.id, job.code, job.title, job.status, job.priority,
        job.scheduled_at, job.completed_at, job.assigned_to,
        project.name as project_name,
        profile.full_name as assigned_to_name,
        exists (
          select 1 from service_customer_requests request
          where request.linked_job_id = job.id
            and request.status not in ('closed', 'void')
            and (
              (request.responded_at is null and request.response_due_at < ${now})
              or (request.resolved_at is null and request.resolution_due_at < ${now})
            )
        ) as sla_overdue,
        exists (
          select 1 from service_maintenance_occurrences occurrence
          where occurrence.job_id = job.id
            and (
              occurrence.status = 'overdue'
              or (occurrence.status = 'scheduled' and occurrence.due_on < ${today})
            )
        ) as maintenance_overdue,
        (select count(*)::int from service_visits visit
          where visit.job_id = job.id and visit.status = 'completed') as visit_count,
        (select coalesce(sum(extract(epoch from (entry.ended_at - entry.started_at))), 0)::bigint
          from service_time_entries entry
          where entry.job_id = job.id and entry.ended_at is not null) as work_seconds
      from service_jobs job
      join projects project on project.id = job.project_id
      left join profiles profile on profile.id = job.assigned_to
      where job.scheduled_at >= ${query.from} and job.scheduled_at < ${query.to}
    )
    select
      count(*)::int as total,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where sla_overdue)::int as overdue_sla,
      count(*) filter (where maintenance_overdue)::int as overdue_maintenance,
      coalesce(sum(work_seconds), 0)::bigint as work_seconds,
      coalesce(sum(visit_count), 0)::int as visits,
      count(*) filter (where status = 'completed' and visit_count > 0)::int as completed_with_visits,
      count(*) filter (where status = 'completed' and visit_count = 1)::int as completed_with_one_visit
    from cohort
  `);
  const raw = result.rows[0] as Record<string, string | number> | undefined;
  const number = (key: string) => Number(raw?.[key] ?? 0);
  const metrics = summarizeServiceMetrics({
    total: number("total"),
    completed: number("completed"),
    overdueSla: number("overdue_sla"),
    overdueMaintenance: number("overdue_maintenance"),
    workSeconds: number("work_seconds"),
    visits: number("visits"),
    completedWithVisits: number("completed_with_visits"),
    completedWithOneVisit: number("completed_with_one_visit"),
  });
  const rows = await db.select({
    id: serviceJobs.id,
    code: serviceJobs.code,
    title: serviceJobs.title,
    projectName: projects.name,
    status: serviceJobs.status,
    priority: serviceJobs.priority,
    assignedToName: profiles.fullName,
    scheduledAt: serviceJobs.scheduledAt,
    completedAt: serviceJobs.completedAt,
    visitCount: sql<number>`(
      select count(*)::int from ${serviceVisits} visit
      where visit.job_id = ${serviceJobs.id} and visit.status = 'completed'
    )`,
    workMinutes: sql<number>`coalesce((
      select round(sum(extract(epoch from (entry.ended_at - entry.started_at))) / 60)::int
      from ${serviceTimeEntries} entry
      where entry.job_id = ${serviceJobs.id} and entry.ended_at is not null
    ), 0)`,
  }).from(serviceJobs)
    .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
    .leftJoin(profiles, eq(serviceJobs.assignedTo, profiles.id))
    .where(and(gte(serviceJobs.scheduledAt, query.from), lt(serviceJobs.scheduledAt, query.to)))
    .orderBy(desc(serviceJobs.scheduledAt), asc(serviceJobs.id))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);
  return {
    metrics,
    rows,
    page: query.page,
    limit: query.limit,
    total: metrics.total,
    pageCount: Math.max(1, Math.ceil(metrics.total / query.limit)),
    range: { from: query.from, to: query.to },
  };
}
