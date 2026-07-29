import { and, asc, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  installedAssets,
  products,
  profiles,
  projects,
  serviceAttachments,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobMaterials,
  serviceJobs,
  serviceSignatures,
  serviceTimeEntries,
  serviceVisits,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import { canAccessServiceJob, fieldJobDateRange } from "@/lib/services/access";

export type FieldServiceActor = {
  userId: string;
  role: Role;
};

export async function resolveServiceJobAccess(actor: FieldServiceActor, jobId: string) {
  const [jobRows, crew] = await Promise.all([
    db.select({
      id: serviceJobs.id,
      projectId: serviceJobs.projectId,
      primaryAssigneeId: serviceJobs.assignedTo,
    }).from(serviceJobs).where(eq(serviceJobs.id, jobId)).limit(1),
    db.select({ profileId: serviceJobAssignments.profileId })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.jobId, jobId),
        isNull(serviceJobAssignments.removedAt),
      )),
  ]);
  const job = jobRows[0];
  if (!job) return null;
  return canAccessServiceJob({
    role: actor.role,
    profileId: actor.userId,
    primaryAssigneeId: job.primaryAssigneeId,
    crewProfileIds: crew.map((item) => item.profileId),
  }) ? job : null;
}

export async function getFieldServiceJobs(input: {
  actor: FieldServiceActor;
  scope: "today" | "week";
  now?: Date;
}) {
  const range = fieldJobDateRange(input.scope, input.now);
  const assignmentFilter = input.actor.role === "technician"
    ? or(
      eq(serviceJobs.assignedTo, input.actor.userId),
      sql`exists (
        select 1 from ${serviceJobAssignments}
        where ${serviceJobAssignments.jobId} = ${serviceJobs.id}
          and ${serviceJobAssignments.profileId} = ${input.actor.userId}
          and ${serviceJobAssignments.removedAt} is null
      )`,
    )
    : undefined;

  return db.select({
    id: serviceJobs.id,
    code: serviceJobs.code,
    projectId: serviceJobs.projectId,
    projectName: projects.name,
    customerName: customers.name,
    address: projects.address,
    siteContactName: projects.siteContactName,
    siteContactPhone: projects.siteContactPhone,
    serviceType: serviceJobs.serviceType,
    title: serviceJobs.title,
    status: serviceJobs.status,
    priority: serviceJobs.priority,
    assignedTo: serviceJobs.assignedTo,
    assignedToName: profiles.fullName,
    scheduledAt: serviceJobs.scheduledAt,
    checklist: serviceJobs.checklist,
    completionNote: serviceJobs.completionNote,
    updatedAt: serviceJobs.updatedAt,
  }).from(serviceJobs)
    .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
    .leftJoin(customers, eq(projects.customerId, customers.id))
    .leftJoin(profiles, eq(serviceJobs.assignedTo, profiles.id))
    .where(and(
      gte(serviceJobs.scheduledAt, range.from),
      lt(serviceJobs.scheduledAt, range.to),
      assignmentFilter,
    ))
    .orderBy(asc(serviceJobs.scheduledAt), desc(serviceJobs.priority));
}

export async function getFieldServiceJobDetail(actor: FieldServiceActor, jobId: string) {
  const access = await resolveServiceJobAccess(actor, jobId);
  if (!access) return null;

  const [job] = await db.select({
    id: serviceJobs.id,
    code: serviceJobs.code,
    projectId: serviceJobs.projectId,
    projectName: projects.name,
    customerName: customers.name,
    address: projects.address,
    siteContactName: projects.siteContactName,
    siteContactPhone: projects.siteContactPhone,
    serviceType: serviceJobs.serviceType,
    title: serviceJobs.title,
    description: serviceJobs.description,
    status: serviceJobs.status,
    priority: serviceJobs.priority,
    assignedTo: serviceJobs.assignedTo,
    scheduledAt: serviceJobs.scheduledAt,
    completedAt: serviceJobs.completedAt,
    checklist: serviceJobs.checklist,
    completionNote: serviceJobs.completionNote,
    updatedAt: serviceJobs.updatedAt,
  }).from(serviceJobs)
    .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
    .leftJoin(customers, eq(projects.customerId, customers.id))
    .where(eq(serviceJobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const [crew, materials, assets, attachments, signatures, visits, timeEntries, events] = await Promise.all([
    db.select({
      profileId: serviceJobAssignments.profileId,
      name: profiles.fullName,
      assignmentRole: serviceJobAssignments.assignmentRole,
      assignedAt: serviceJobAssignments.assignedAt,
    }).from(serviceJobAssignments)
      .innerJoin(profiles, eq(serviceJobAssignments.profileId, profiles.id))
      .where(and(
        eq(serviceJobAssignments.jobId, jobId),
        isNull(serviceJobAssignments.removedAt),
      ))
      .orderBy(asc(serviceJobAssignments.assignedAt)),
    db.select({
      id: serviceJobMaterials.id,
      productId: serviceJobMaterials.productId,
      productName: products.name,
      unitName: serviceJobMaterials.unitName,
      plannedQuantity: serviceJobMaterials.plannedQuantity,
      usedQuantity: serviceJobMaterials.usedQuantity,
      note: serviceJobMaterials.note,
    }).from(serviceJobMaterials)
      .innerJoin(products, eq(serviceJobMaterials.productId, products.id))
      .where(eq(serviceJobMaterials.jobId, jobId))
      .orderBy(asc(products.name)),
    db.select({
      id: installedAssets.id,
      name: installedAssets.name,
      assetKind: installedAssets.assetKind,
      brand: installedAssets.brand,
      model: installedAssets.model,
      serialNumber: installedAssets.serialNumber,
      macAddress: installedAssets.macAddress,
      ipAddress: installedAssets.ipAddress,
      locationLabel: installedAssets.locationLabel,
      status: installedAssets.status,
    }).from(installedAssets)
      .where(eq(installedAssets.jobId, jobId))
      .orderBy(asc(installedAssets.name)),
    db.select({
      id: serviceAttachments.id,
      category: serviceAttachments.category,
      fileName: serviceAttachments.fileName,
      mimeType: serviceAttachments.mimeType,
      sizeBytes: serviceAttachments.sizeBytes,
      caption: serviceAttachments.caption,
      createdAt: serviceAttachments.createdAt,
    }).from(serviceAttachments)
      .where(and(
        eq(serviceAttachments.jobId, jobId),
        isNull(serviceAttachments.deletedAt),
      ))
      .orderBy(desc(serviceAttachments.createdAt)),
    db.select({
      id: serviceSignatures.id,
      signerName: serviceSignatures.signerName,
      signerRole: serviceSignatures.signerRole,
      documentHash: serviceSignatures.documentHash,
      signedAt: serviceSignatures.signedAt,
    }).from(serviceSignatures)
      .where(eq(serviceSignatures.jobId, jobId))
      .orderBy(desc(serviceSignatures.signedAt)),
    db.select({
      id: serviceVisits.id,
      profileId: serviceVisits.profileId,
      status: serviceVisits.status,
      checkedInAt: serviceVisits.checkedInAt,
      checkedOutAt: serviceVisits.checkedOutAt,
      note: serviceVisits.note,
    }).from(serviceVisits)
      .where(eq(serviceVisits.jobId, jobId))
      .orderBy(desc(serviceVisits.checkedInAt)),
    db.select({
      id: serviceTimeEntries.id,
      profileId: serviceTimeEntries.profileId,
      entryType: serviceTimeEntries.entryType,
      startedAt: serviceTimeEntries.startedAt,
      endedAt: serviceTimeEntries.endedAt,
    }).from(serviceTimeEntries)
      .where(eq(serviceTimeEntries.jobId, jobId))
      .orderBy(desc(serviceTimeEntries.startedAt)),
    db.select({
      id: serviceJobEvents.id,
      eventType: serviceJobEvents.eventType,
      actorId: serviceJobEvents.actorId,
      payload: serviceJobEvents.payload,
      createdAt: serviceJobEvents.createdAt,
    }).from(serviceJobEvents)
      .where(eq(serviceJobEvents.jobId, jobId))
      .orderBy(desc(serviceJobEvents.createdAt))
      .limit(200),
  ]);

  return {
    ...job,
    crew,
    materials,
    assets,
    attachments,
    signatures,
    visits,
    timeEntries,
    events,
  };
}
