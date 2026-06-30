import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, projects } from "@/db/schema";

export async function getProjectRows() {
  return db.select({
    id: projects.id,
    name: projects.name,
    customerId: projects.customerId,
    address: projects.address,
    note: projects.note,
    status: projects.status,
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
    customerName: customers.name,
    orderCount: sql<number>`(select count(*) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} != 'cancelled')::int`,
    totalValue: sql<string>`coalesce((select sum(${orders.total}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} not in ('cancelled','quote','merged')), 0)`,
    remaining: sql<string>`coalesce((select sum(${orders.total} - ${orders.amountPaid}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} = 'completed'), 0)`,
    createdAt: projects.createdAt,
  }).from(projects).leftJoin(customers, eq(projects.customerId, customers.id)).where(eq(projects.id, id)).limit(1);
  if (!project) return null;

  const relatedOrders = await db.select({
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
    .limit(50);

  return { project, orders: relatedOrders };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
