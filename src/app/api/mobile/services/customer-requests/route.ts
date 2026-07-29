import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
  serviceJobs,
} from "@/db/schema";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const page = Math.max(1, numberParam(request, "page", 1));
  const pageSize = Math.min(100, Math.max(1, numberParam(request, "size", 25)));
  const status = searchParam(request, "status");
  const where = status
    ? and(
        isNotNull(serviceCustomerRequests.submittedAt),
        eq(serviceCustomerRequests.status, status),
      )
    : isNotNull(serviceCustomerRequests.submittedAt);
  const rows = await db.select({
    id: serviceCustomerRequests.id,
    code: serviceCustomerRequests.code,
    projectId: serviceCustomerRequests.projectId,
    projectName: projects.name,
    title: serviceCustomerRequests.title,
    contactName: serviceCustomerRequests.contactName,
    contactPhone: serviceCustomerRequests.contactPhone,
    priority: serviceCustomerRequests.priority,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    responseDueAt: serviceCustomerRequests.responseDueAt,
    resolutionDueAt: serviceCustomerRequests.resolutionDueAt,
    linkedJobId: serviceCustomerRequests.linkedJobId,
    linkedJobCode: serviceJobs.code,
    attachmentCount: sql<number>`(
      select count(*)::int from ${serviceCustomerRequestAttachments}
      where ${serviceCustomerRequestAttachments.requestId} = ${serviceCustomerRequests.id}
    )`,
    responseOverdue: sql<boolean>`(
      ${serviceCustomerRequests.respondedAt} is null
      and ${serviceCustomerRequests.responseDueAt} < now()
    )`,
    resolutionOverdue: sql<boolean>`(
      ${serviceCustomerRequests.resolvedAt} is null
      and ${serviceCustomerRequests.resolutionDueAt} < now()
    )`,
    createdAt: serviceCustomerRequests.createdAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .leftJoin(serviceJobs, eq(serviceCustomerRequests.linkedJobId, serviceJobs.id))
    .where(where)
    .orderBy(desc(serviceCustomerRequests.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [total] = await db.select({ value: sql<number>`count(*)::int` })
    .from(serviceCustomerRequests).where(where);
  return mobileOk({ rows, page, pageSize, total: total.value });
}
