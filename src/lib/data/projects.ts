import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  installedAssets,
  orders,
  products,
  profiles,
  projects,
  serviceJobMaterials,
  serviceJobs,
  serviceStatusLogs,
  warrantyClaims,
} from "@/db/schema";

export async function getProjectRows() {
  return db.select({
    id: projects.id,
    name: projects.name,
    customerId: projects.customerId,
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
    customerName: customers.name,
    orderCount: sql<number>`(select count(*) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} != 'cancelled')::int`,
    totalValue: sql<string>`coalesce((select sum(${orders.total}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} not in ('cancelled','quote','merged')), 0)`,
    remaining: sql<string>`coalesce((select sum(${orders.total} - ${orders.amountPaid}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} = 'completed'), 0)`,
    createdAt: projects.createdAt,
  }).from(projects).leftJoin(customers, eq(projects.customerId, customers.id)).orderBy(desc(projects.createdAt));
}

export type ProjectRow = Awaited<ReturnType<typeof getProjectRows>>[number];

export async function getProjectDetail(id: string) {
  const [project] = await db.select({
    id: projects.id,
    name: projects.name,
    customerId: projects.customerId,
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
    customerName: customers.name,
    orderCount: sql<number>`(select count(*) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} != 'cancelled')::int`,
    totalValue: sql<string>`coalesce((select sum(${orders.total}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} not in ('cancelled','quote','merged')), 0)`,
    remaining: sql<string>`coalesce((select sum(${orders.total} - ${orders.amountPaid}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} = 'completed'), 0)`,
    createdAt: projects.createdAt,
  }).from(projects).leftJoin(customers, eq(projects.customerId, customers.id)).where(eq(projects.id, id)).limit(1);
  if (!project) return null;

  const [relatedOrders, jobs, assets, claims, materials, statusLogs] = await Promise.all([
    db.select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      amountPaid: orders.amountPaid,
      createdAt: orders.createdAt,
      customerName: customers.name,
      projectName: orders.projectName,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.projectId, id))
      .orderBy(desc(orders.createdAt))
      .limit(50),
    db.select({
      id: serviceJobs.id,
      code: serviceJobs.code,
      serviceType: serviceJobs.serviceType,
      title: serviceJobs.title,
      status: serviceJobs.status,
      priority: serviceJobs.priority,
      assignedTo: serviceJobs.assignedTo,
      assignedToName: profiles.fullName,
      scheduledAt: serviceJobs.scheduledAt,
      completedAt: serviceJobs.completedAt,
      description: serviceJobs.description,
      checklist: serviceJobs.checklist,
      quoteOrderId: serviceJobs.quoteOrderId,
      materialOrderId: serviceJobs.materialOrderId,
    }).from(serviceJobs)
      .leftJoin(profiles, eq(serviceJobs.assignedTo, profiles.id))
      .where(eq(serviceJobs.projectId, id))
      .orderBy(desc(serviceJobs.createdAt)),
    db.select({
      id: installedAssets.id,
      jobId: installedAssets.jobId,
      productId: installedAssets.productId,
      assetKind: installedAssets.assetKind,
      name: installedAssets.name,
      brand: installedAssets.brand,
      model: installedAssets.model,
      serialNumber: installedAssets.serialNumber,
      macAddress: installedAssets.macAddress,
      ipAddress: installedAssets.ipAddress,
      locationLabel: installedAssets.locationLabel,
      installedAt: installedAssets.installedAt,
      customerWarrantyEndsOn: installedAssets.customerWarrantyEndsOn,
      supplierWarrantyEndsOn: installedAssets.supplierWarrantyEndsOn,
      status: installedAssets.status,
      note: installedAssets.note,
    }).from(installedAssets)
      .where(eq(installedAssets.projectId, id))
      .orderBy(desc(installedAssets.createdAt)),
    db.select({
      id: warrantyClaims.id,
      code: warrantyClaims.code,
      jobId: warrantyClaims.jobId,
      assetId: warrantyClaims.assetId,
      title: warrantyClaims.title,
      description: warrantyClaims.description,
      status: warrantyClaims.status,
      priority: warrantyClaims.priority,
      reportedAt: warrantyClaims.reportedAt,
      scheduledAt: warrantyClaims.scheduledAt,
      resolvedAt: warrantyClaims.resolvedAt,
      diagnosis: warrantyClaims.diagnosis,
      resolution: warrantyClaims.resolution,
    }).from(warrantyClaims)
      .where(eq(warrantyClaims.projectId, id))
      .orderBy(desc(warrantyClaims.reportedAt)),
    db.select({
      id: serviceJobMaterials.id,
      jobId: serviceJobMaterials.jobId,
      jobCode: serviceJobs.code,
      jobTitle: serviceJobs.title,
      productId: serviceJobMaterials.productId,
      productName: products.name,
      sku: products.sku,
      unitName: serviceJobMaterials.unitName,
      plannedQuantity: serviceJobMaterials.plannedQuantity,
      usedQuantity: serviceJobMaterials.usedQuantity,
      note: serviceJobMaterials.note,
    }).from(serviceJobMaterials)
      .innerJoin(serviceJobs, eq(serviceJobMaterials.jobId, serviceJobs.id))
      .innerJoin(products, eq(serviceJobMaterials.productId, products.id))
      .where(eq(serviceJobs.projectId, id))
      .orderBy(desc(serviceJobMaterials.createdAt)),
    db.select({
      id: serviceStatusLogs.id,
      jobId: serviceStatusLogs.jobId,
      fromStatus: serviceStatusLogs.fromStatus,
      toStatus: serviceStatusLogs.toStatus,
      note: serviceStatusLogs.note,
      createdByName: profiles.fullName,
      createdAt: serviceStatusLogs.createdAt,
    }).from(serviceStatusLogs)
      .innerJoin(serviceJobs, eq(serviceStatusLogs.jobId, serviceJobs.id))
      .leftJoin(profiles, eq(serviceStatusLogs.createdBy, profiles.id))
      .where(eq(serviceJobs.projectId, id))
      .orderBy(desc(serviceStatusLogs.createdAt)),
  ]);

  return { project, orders: relatedOrders, jobs, assets, claims, materials, statusLogs };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
