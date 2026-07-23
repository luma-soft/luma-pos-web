import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  installedAssets,
  orders,
  productUnits,
  products,
  profiles,
  projects,
  serviceCostEntries,
  serviceHandoverDocuments,
  serviceJobMaterials,
  serviceJobs,
  serviceMaintenancePlans,
  serviceMaterialAllocations,
  serviceStatusLogs,
  stockMovements,
  warrantyClaims,
} from "@/db/schema";
import { calculateServiceProjectProfitability } from "@/lib/services/domain";
import { coercePageSize } from "@/lib/pagination";

const projectRowSelection = {
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
};

export async function getProjectRows() {
  return db.select(projectRowSelection).from(projects).leftJoin(customers, eq(projects.customerId, customers.id)).orderBy(desc(projects.createdAt));
}

export async function getProjectPage(page = 1, pageSize?: number) {
  const safePage = Math.max(1, page);
  const size = coercePageSize(pageSize);
  const [rows, countRows] = await Promise.all([
    db.select(projectRowSelection)
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .orderBy(desc(projects.createdAt))
      .limit(size)
      .offset((safePage - 1) * size),
    db.select({ total: count() }).from(projects),
  ]);
  const total = countRows[0]?.total ?? 0;
  return { rows, total, page: safePage, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) };
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

  const [relatedOrders, jobs, assets, claims, materials, statusLogs, costEntries, costSummary, plannedMaterialSummary, handoverDocuments, maintenancePlans] = await Promise.all([
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
      laborCharge: warrantyClaims.laborCharge,
      materialCharge: warrantyClaims.materialCharge,
      assetName: installedAssets.name,
    }).from(warrantyClaims)
      .leftJoin(installedAssets, eq(warrantyClaims.assetId, installedAssets.id))
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
      baseUnit: products.baseUnit,
      unitName: serviceJobMaterials.unitName,
      unitMultiplier: sql<string>`case
        when ${serviceJobMaterials.unitName} = ${products.baseUnit} then 1
        else coalesce((select ${productUnits.multiplier} from ${productUnits} where ${productUnits.productId} = ${serviceJobMaterials.productId} and ${productUnits.unitName} = ${serviceJobMaterials.unitName} limit 1), 0)
      end`,
      plannedQuantity: serviceJobMaterials.plannedQuantity,
      usedQuantity: serviceJobMaterials.usedQuantity,
      issuedBaseQuantity: sql<string>`coalesce(-(select sum(${stockMovements.quantity}) from ${stockMovements} where ${stockMovements.refType} = 'service_material' and ${stockMovements.refId} = ${serviceJobMaterials.id}), 0)`,
      stockWarehouseId: sql<string | null>`(select ${stockMovements.warehouseId} from ${stockMovements} where ${stockMovements.refType} = 'service_material' and ${stockMovements.refId} = ${serviceJobMaterials.id} order by ${stockMovements.createdAt} asc limit 1)`,
      reservedBaseQuantity: sql<string>`coalesce((select sum(${serviceMaterialAllocations.remainingQuantity}) from ${serviceMaterialAllocations} where ${serviceMaterialAllocations.materialId} = ${serviceJobMaterials.id} and ${serviceMaterialAllocations.status} = 'reserved'), 0)`,
      reservedWarehouseId: sql<string | null>`(select ${serviceMaterialAllocations.warehouseId} from ${serviceMaterialAllocations} where ${serviceMaterialAllocations.materialId} = ${serviceJobMaterials.id} and ${serviceMaterialAllocations.status} = 'reserved' order by ${serviceMaterialAllocations.createdAt} asc limit 1)`,
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
    db.select({
      id: serviceCostEntries.id,
      jobId: serviceCostEntries.jobId,
      type: serviceCostEntries.type,
      description: serviceCostEntries.description,
      quantity: serviceCostEntries.quantity,
      unitCost: serviceCostEntries.unitCost,
      amount: serviceCostEntries.amount,
      staffId: serviceCostEntries.staffId,
      staffName: profiles.fullName,
      incurredOn: serviceCostEntries.incurredOn,
      note: serviceCostEntries.note,
      createdAt: serviceCostEntries.createdAt,
    }).from(serviceCostEntries)
      .leftJoin(profiles, eq(serviceCostEntries.staffId, profiles.id))
      .where(eq(serviceCostEntries.projectId, id))
      .orderBy(desc(serviceCostEntries.incurredOn), desc(serviceCostEntries.createdAt)),
    db.select({
      laborCost: sql<string>`coalesce(sum(case when ${serviceCostEntries.type} = 'labor' then ${serviceCostEntries.amount} else 0 end), 0)`,
      otherCost: sql<string>`coalesce(sum(case when ${serviceCostEntries.type} <> 'labor' then ${serviceCostEntries.amount} else 0 end), 0)`,
    }).from(serviceCostEntries).where(eq(serviceCostEntries.projectId, id)),
    db.select({
      plannedCost: sql<string>`coalesce(sum(${serviceJobMaterials.plannedQuantity} * case when ${serviceJobMaterials.unitName} = ${products.baseUnit} then 1 else coalesce((select ${productUnits.multiplier} from ${productUnits} where ${productUnits.productId} = ${serviceJobMaterials.productId} and ${productUnits.unitName} = ${serviceJobMaterials.unitName} limit 1), 0) end * ${products.costPrice}), 0)`,
    }).from(serviceJobMaterials)
      .innerJoin(serviceJobs, eq(serviceJobMaterials.jobId, serviceJobs.id))
      .innerJoin(products, eq(serviceJobMaterials.productId, products.id))
      .where(eq(serviceJobs.projectId, id)),
    db.select({
      id: serviceHandoverDocuments.id,
      jobId: serviceHandoverDocuments.jobId,
      type: serviceHandoverDocuments.type,
      title: serviceHandoverDocuments.title,
      content: serviceHandoverDocuments.content,
      photoUrls: serviceHandoverDocuments.photoUrls,
      signedBy: serviceHandoverDocuments.signedBy,
      signedAt: serviceHandoverDocuments.signedAt,
      status: serviceHandoverDocuments.status,
      createdAt: serviceHandoverDocuments.createdAt,
    }).from(serviceHandoverDocuments)
      .where(eq(serviceHandoverDocuments.projectId, id))
      .orderBy(desc(serviceHandoverDocuments.createdAt)),
    db.select({
      id: serviceMaintenancePlans.id,
      assetId: serviceMaintenancePlans.assetId,
      assetName: installedAssets.name,
      title: serviceMaintenancePlans.title,
      intervalDays: serviceMaintenancePlans.intervalDays,
      nextDueOn: serviceMaintenancePlans.nextDueOn,
      lastCompletedOn: serviceMaintenancePlans.lastCompletedOn,
      assignedTo: serviceMaintenancePlans.assignedTo,
      assignedToName: profiles.fullName,
      isActive: serviceMaintenancePlans.isActive,
      note: serviceMaintenancePlans.note,
    }).from(serviceMaintenancePlans)
      .leftJoin(installedAssets, eq(serviceMaintenancePlans.assetId, installedAssets.id))
      .leftJoin(profiles, eq(serviceMaintenancePlans.assignedTo, profiles.id))
      .where(eq(serviceMaintenancePlans.projectId, id))
      .orderBy(serviceMaintenancePlans.nextDueOn),
  ]);

  const [actualMaterialSummary] = await db.select({
    materialCost: sql<string>`coalesce(sum(abs(${stockMovements.quantity}) * coalesce(${stockMovements.unitCost}, 0)), 0)`,
  }).from(stockMovements)
    .innerJoin(serviceJobMaterials, and(eq(stockMovements.refType, "service_material"), eq(stockMovements.refId, serviceJobMaterials.id)))
    .innerJoin(serviceJobs, eq(serviceJobMaterials.jobId, serviceJobs.id))
    .where(and(eq(serviceJobs.projectId, id), sql`${stockMovements.quantity} < 0`));
  const revenue = Number(project.totalValue);
  const materialCost = Number(actualMaterialSummary?.materialCost ?? 0);
  const laborCost = Number(costSummary[0]?.laborCost ?? 0);
  const otherCost = Number(costSummary[0]?.otherCost ?? 0);
  const profitability = calculateServiceProjectProfitability({ revenue, materialCost, laborCost, otherCost });
  return {
    project,
    orders: relatedOrders,
    jobs,
    assets,
    claims,
    materials,
    statusLogs,
    costEntries,
    profitability,
    plannedMaterialCost: Number(plannedMaterialSummary[0]?.plannedCost ?? 0),
    handoverDocuments,
    maintenancePlans,
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
