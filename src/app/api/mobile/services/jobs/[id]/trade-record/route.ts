import { recordActivity } from "@/lib/audit/activity-log";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceJobAssignments,
  serviceJobs,
  serviceJobTradeRecords,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { canAccessServiceJob } from "@/lib/services/access";
import { serviceTradeRecordSchema } from "@/lib/services/project-specialized-schemas";

type RouteContext = { params: Promise<{ id: string }> };

async function loadAuthorizedJob(
  storeId: string,
  userId: string,
  role: Role,
  jobId: string,
) {
  const [job] = await db.select({
    id: serviceJobs.id,
    code: serviceJobs.code,
    title: serviceJobs.title,
    projectId: serviceJobs.projectId,
    serviceType: serviceJobs.serviceType,
    assignedTo: serviceJobs.assignedTo,
    status: serviceJobs.status,
  }).from(serviceJobs).where(and(
    eq(serviceJobs.storeId, storeId),
    eq(serviceJobs.id, jobId),
  )).limit(1);
  if (!job) return null;
  const crew = role === "technician"
    ? await db.select({ profileId: serviceJobAssignments.profileId })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.storeId, storeId),
        eq(serviceJobAssignments.jobId, jobId),
        isNull(serviceJobAssignments.removedAt),
      ))
    : [];
  return canAccessServiceJob({
    role,
    profileId: userId,
    primaryAssigneeId: job.assignedTo,
    crewProfileIds: crew.map((assignment) => assignment.profileId),
  })
    ? job
    : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const job = await loadAuthorizedJob(gate.storeId, gate.userId, gate.role, id);
  if (!job) return mobileError("errors.notFound", 404);
  const [record] = await db.select().from(serviceJobTradeRecords).where(and(
    eq(serviceJobTradeRecords.storeId, gate.storeId),
    eq(serviceJobTradeRecords.jobId, id),
  )).limit(1);
  return mobileOk(record ?? {
    jobId: id,
    serviceType: job.serviceType,
    schemaVersion: 1,
    version: 0,
    data: null,
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const job = await loadAuthorizedJob(gate.storeId, gate.userId, gate.role, id);
  if (!job) return mobileError("errors.notFound", 404);
  if (["completed", "cancelled"].includes(job.status)) {
    return mobileError("services.errors.invalidTransition", 409);
  }
  const body = await readJson(request);
  const payload = body && typeof body === "object" && "data" in body
    ? (body as { data: unknown }).data
    : body;
  const parsed = serviceTradeRecordSchema.safeParse(payload);
  if (!parsed.success || parsed.data.serviceType !== job.serviceType) {
    return mobileError("errors.invalidData");
  }
  const now = new Date();
  const record = await db.transaction(async (tx) => {
    const [lockedJob] = await tx.select({ status: serviceJobs.status }).from(serviceJobs)
      .where(and(eq(serviceJobs.storeId, gate.storeId), eq(serviceJobs.id, id))).limit(1).for("update");
    if (!lockedJob || ["completed", "cancelled"].includes(lockedJob.status)) throw new Error("SERVICE_FIELD_JOB_TERMINAL");
    const [before] = await tx.select().from(serviceJobTradeRecords)
      .where(and(eq(serviceJobTradeRecords.storeId, gate.storeId), eq(serviceJobTradeRecords.jobId, id))).limit(1);
    if (before && JSON.stringify(before.data) === JSON.stringify(parsed.data)) return before;
    const [saved] = await tx.insert(serviceJobTradeRecords).values({
    storeId: gate.storeId,
    jobId: id,
    serviceType: job.serviceType,
    data: parsed.data,
    createdBy: gate.userId,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: serviceJobTradeRecords.jobId,
    set: {
      data: parsed.data,
      version: sql`${serviceJobTradeRecords.version} + 1`,
      updatedAt: now,
    },
  }).returning();
    await recordActivity(tx, {
      storeId: gate.storeId, actorId: gate.userId, source: "mobile",
      action: "service.trade_record.updated", entityType: "service_job_trade_record", entityId: saved.id,
      before: before ? { version: before.version } : null,
      after: { code: job.code, name: job.title, version: saved.version, serviceType: job.serviceType },
      metadata: { projectId: job.projectId, jobId: id, serviceType: job.serviceType, version: saved.version },
    });
    return saved;
  });
  return mobileOk(record);
}
