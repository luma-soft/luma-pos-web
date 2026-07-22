import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  installedAssets,
  products,
  profiles,
  projects,
  serviceJobs,
  warrantyClaims,
} from "@/db/schema";

export async function getServiceDashboard() {
  const [projectRows, jobRows, claimRows] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      customerId: projects.customerId,
      customerName: customers.name,
      address: projects.address,
      note: projects.note,
      status: projects.status,
      serviceType: projects.serviceType,
      serviceStage: projects.serviceStage,
      progressPercent: projects.progressPercent,
      startsOn: projects.startsOn,
      targetEndsOn: projects.targetEndsOn,
      siteContactName: projects.siteContactName,
      siteContactPhone: projects.siteContactPhone,
      jobCount: sql<number>`(select count(*) from ${serviceJobs} where ${serviceJobs.projectId} = ${projects.id})::int`,
      openJobCount: sql<number>`(select count(*) from ${serviceJobs} where ${serviceJobs.projectId} = ${projects.id} and ${serviceJobs.status} not in ('completed','cancelled'))::int`,
      assetCount: sql<number>`(select count(*) from ${installedAssets} where ${installedAssets.projectId} = ${projects.id} and ${installedAssets.status} != 'removed')::int`,
      openClaimCount: sql<number>`(select count(*) from ${warrantyClaims} where ${warrantyClaims.projectId} = ${projects.id} and ${warrantyClaims.status} not in ('closed','void'))::int`,
      createdAt: projects.createdAt,
    }).from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(isNotNull(projects.serviceType))
      .orderBy(desc(projects.createdAt)),
    db.select({
      id: serviceJobs.id,
      code: serviceJobs.code,
      projectId: serviceJobs.projectId,
      projectName: projects.name,
      serviceType: serviceJobs.serviceType,
      title: serviceJobs.title,
      status: serviceJobs.status,
      priority: serviceJobs.priority,
      assignedToName: profiles.fullName,
      scheduledAt: serviceJobs.scheduledAt,
      checklist: serviceJobs.checklist,
      createdAt: serviceJobs.createdAt,
    }).from(serviceJobs)
      .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
      .leftJoin(profiles, eq(serviceJobs.assignedTo, profiles.id))
      .orderBy(desc(serviceJobs.createdAt))
      .limit(200),
    db.select({
      id: warrantyClaims.id,
      code: warrantyClaims.code,
      projectId: warrantyClaims.projectId,
      projectName: projects.name,
      assetName: installedAssets.name,
      title: warrantyClaims.title,
      status: warrantyClaims.status,
      priority: warrantyClaims.priority,
      reportedAt: warrantyClaims.reportedAt,
      scheduledAt: warrantyClaims.scheduledAt,
    }).from(warrantyClaims)
      .innerJoin(projects, eq(warrantyClaims.projectId, projects.id))
      .leftJoin(installedAssets, eq(warrantyClaims.assetId, installedAssets.id))
      .orderBy(desc(warrantyClaims.reportedAt))
      .limit(200),
  ]);

  return {
    projects: projectRows,
    jobs: jobRows,
    claims: claimRows,
    metrics: {
      activeProjects: projectRows.filter((project) =>
        project.serviceStage !== "completed" && project.serviceStage !== "cancelled"
      ).length,
      openJobs: jobRows.filter((job) => job.status !== "completed" && job.status !== "cancelled").length,
      installedAssets: projectRows.reduce((sum, project) => sum + project.assetCount, 0),
      openClaims: claimRows.filter((claim) => claim.status !== "closed" && claim.status !== "void").length,
    },
  };
}

export type ServiceDashboard = Awaited<ReturnType<typeof getServiceDashboard>>;
export type ServiceProjectRow = ServiceDashboard["projects"][number];
export type ServiceJobRow = ServiceDashboard["jobs"][number];
export type WarrantyClaimRow = ServiceDashboard["claims"][number];

export async function getServiceFormOptions() {
  const [customerOptions, projectOptions, assigneeOptions, productOptions, jobOptions, assetOptions] = await Promise.all([
    db.select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.isActive, true))
      .orderBy(asc(customers.name))
      .limit(300),
    db.select({ id: projects.id, name: projects.name, serviceType: projects.serviceType })
      .from(projects)
      .where(and(isNotNull(projects.serviceType), ne(projects.status, "done")))
      .orderBy(asc(projects.name))
      .limit(300),
    db.select({ id: profiles.id, name: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.isActive, true))
      .orderBy(asc(profiles.fullName)),
    db.select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
    }).from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(500),
    db.select({
      id: serviceJobs.id,
      projectId: serviceJobs.projectId,
      code: serviceJobs.code,
      title: serviceJobs.title,
    }).from(serviceJobs)
      .orderBy(desc(serviceJobs.createdAt))
      .limit(500),
    db.select({
      id: installedAssets.id,
      projectId: installedAssets.projectId,
      jobId: installedAssets.jobId,
      name: installedAssets.name,
      serialNumber: installedAssets.serialNumber,
    }).from(installedAssets)
      .where(ne(installedAssets.status, "removed"))
      .orderBy(asc(installedAssets.name))
      .limit(500),
  ]);

  return { customerOptions, projectOptions, assigneeOptions, productOptions, jobOptions, assetOptions };
}
