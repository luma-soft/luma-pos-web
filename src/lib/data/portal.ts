import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, products, projects, serviceCustomerRequests, storeFeatures } from "@/db/schema";
import { consumePublicRateLimitCore } from "@/lib/services/customer-request-portal";
import { hashCustomerRequestToken, isCustomerRequestTokenViewable } from "@/lib/services/customer-request-token";

/** Customer behind a portal link and the active products of its store; null for an unknown link. */
export async function getPortalCatalog(token: string) {
  const [customer] = await db
    .select({ id: customers.id, storeId: customers.storeId, name: customers.name, type: customers.type, currentDebt: customers.currentDebt, debtLimit: customers.debtLimit })
    .from(customers)
    .where(eq(customers.portalToken, token))
    .limit(1);
  if (!customer) return null;

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      variantName: products.variantName,
      specs: products.specs,
      sku: products.sku,
      baseUnit: products.baseUnit,
      retailPrice: products.retailPrice,
      wholesalePrice: products.wholesalePrice,
      contractorPrice: products.contractorPrice,
      agentPrice: products.agentPrice,
    })
    .from(products)
    .where(and(eq(products.storeId, customer.storeId), eq(products.isActive, true)))
    .orderBy(asc(products.name))
    .limit(500);
  return { customer, productRows };
}

/**
 * Service request behind a customer link, after the public rate limits.
 * Null when the link is unknown, expired or rate limited (the page shows 404).
 */
export async function getServiceRequestPortalView(token: string) {
  const tokenHash = hashCustomerRequestToken(token);
  const [request] = await db.select({
    storeId: serviceCustomerRequests.storeId,
    projectName: projects.name,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    responseDueAt: serviceCustomerRequests.responseDueAt,
    resolutionDueAt: serviceCustomerRequests.resolutionDueAt,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .innerJoin(storeFeatures, and(
      eq(storeFeatures.storeId, serviceCustomerRequests.storeId),
      eq(storeFeatures.featureKey, "field_services"),
      eq(storeFeatures.enabled, true),
    ))
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!request || !isCustomerRequestTokenViewable({
    expiresAt: request.tokenExpiresAt,
  })) return null;
  const storeLimit = await db.transaction((tx) => consumePublicRateLimitCore(tx, {
    storeId: request.storeId,
    key: "customer-request:page:store",
    limit: 10_000,
    windowSeconds: 60,
  }));
  if (!storeLimit.allowed) return null;
  const tokenLimit = await db.transaction((tx) => consumePublicRateLimitCore(tx, {
    storeId: request.storeId,
    key: `customer-request:page:token:${tokenHash}`,
    limit: 60,
    windowSeconds: 3600,
  }));
  if (!tokenLimit.allowed) return null;
  return request;
}
