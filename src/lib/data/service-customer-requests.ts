import "server-only";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
  serviceJobs,
} from "@/db/schema";
import { requireManager } from "@/lib/actions/common";

export async function getManagerServiceCustomerRequests() {
  const gate = await requireManager();
  if (!gate.ok) return { allowed: false as const, rows: [] };
  const rows = await db.select({
    id: serviceCustomerRequests.id,
    code: serviceCustomerRequests.code,
    projectId: serviceCustomerRequests.projectId,
    projectName: projects.name,
    title: serviceCustomerRequests.title,
    description: serviceCustomerRequests.description,
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
    internalNote: serviceCustomerRequests.internalNote,
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
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .leftJoin(serviceJobs, eq(serviceCustomerRequests.linkedJobId, serviceJobs.id))
    .where(isNotNull(serviceCustomerRequests.submittedAt))
    .orderBy(desc(serviceCustomerRequests.createdAt))
    .limit(100);
  const attachments = rows.length === 0 ? [] : await db.select({
    id: serviceCustomerRequestAttachments.id,
    requestId: serviceCustomerRequestAttachments.requestId,
    fileName: serviceCustomerRequestAttachments.fileName,
    mimeType: serviceCustomerRequestAttachments.mimeType,
    sizeBytes: serviceCustomerRequestAttachments.sizeBytes,
    width: serviceCustomerRequestAttachments.width,
    height: serviceCustomerRequestAttachments.height,
    sha256: serviceCustomerRequestAttachments.sha256,
  }).from(serviceCustomerRequestAttachments).where(inArray(
    serviceCustomerRequestAttachments.requestId,
    rows.map((row) => row.id),
  ));
  return {
    allowed: true as const,
    rows: rows.map((row) => ({
      ...row,
      attachments: attachments.filter((attachment) => attachment.requestId === row.id),
    })),
  };
}
