import { recordActivity } from "@/lib/audit/activity-log";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  installedAssets,
  projects,
  serviceCustomerRequests,
} from "@/db/schema";
import { generateCode } from "@/lib/actions/common";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  createCustomerRequestToken,
  hashCustomerRequestToken,
} from "@/lib/services/customer-request-token";
import { serviceCustomerRequestLinkSchema } from "@/lib/services/schemas";

export async function POST(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate);
  const parsed = serviceCustomerRequestLinkSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const value = parsed.data;
  const [project] = await db.select({
    id: projects.id,
    name: projects.name,
    customerId: projects.customerId,
    contactName: projects.siteContactName,
    contactPhone: projects.siteContactPhone,
    customerName: customers.name,
    customerPhone: customers.phone,
  }).from(projects)
    .leftJoin(customers, eq(projects.customerId, customers.id))
    .where(and(eq(projects.storeId, gate.storeId), eq(projects.id, value.projectId)))
    .limit(1);
  if (!project) return mobileError("errors.notFound", 404);
  const customerId = value.customerId ?? project.customerId;
  if (value.customerId && value.customerId !== project.customerId) {
    return mobileError("services.errors.relationMismatch", 409);
  }
  if (value.assetId) {
    const [asset] = await db.select({ id: installedAssets.id })
      .from(installedAssets)
      .where(and(
        eq(installedAssets.id, value.assetId),
        eq(installedAssets.projectId, value.projectId),
      ))
      .limit(1);
    if (!asset) return mobileError("services.errors.relationMismatch", 409);
  }
  const token = createCustomerRequestToken();
  const expiresAt = new Date(Date.now() + value.expiresInDays * 24 * 60 * 60 * 1000);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(serviceCustomerRequests).values({
    storeId: gate.storeId,
    code: generateCode("YC"),
    projectId: project.id,
    customerId,
    assetId: value.assetId ?? null,
    title: `Yêu cầu dịch vụ — ${project.name}`,
    contactName: project.contactName || project.customerName || "Khách hàng",
    contactPhone: project.contactPhone || project.customerPhone || null,
    tokenHash: hashCustomerRequestToken(token),
    tokenExpiresAt: expiresAt,
  }).returning({ id: serviceCustomerRequests.id, code: serviceCustomerRequests.code });
    await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, source: "mobile",
      action: "service.customer_request.link.created", entityType: "service_customer_request", entityId: created.id,
      after: { code: created.code, name: project.name }, metadata: { projectId: project.id, expiresAt } });
    return created;
  });
  const origin = new URL(request.url).origin;
  return mobileOk({
    ...row,
    url: `${origin}/portal/service-request/${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}
