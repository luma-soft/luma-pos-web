import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceCustomerRequests,
  serviceSlaPolicies,
} from "@/db/schema";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenUsable,
} from "@/lib/services/customer-request-token";
import { calculateServiceSlaDeadlines } from "@/lib/services/domain";
import { serviceCustomerRequestSubmitSchema } from "@/lib/services/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const parsed = serviceCustomerRequestSubmitSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const value = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({
      id: serviceCustomerRequests.id,
      status: serviceCustomerRequests.status,
      tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
    }).from(serviceCustomerRequests)
      .where(eq(serviceCustomerRequests.tokenHash, hashCustomerRequestToken(token)))
      .for("update")
      .limit(1);
    if (!current || !isCustomerRequestTokenUsable({
      status: current.status,
      expiresAt: current.tokenExpiresAt,
    })) return null;
    const [policy] = await tx.select({
      responseMinutes: serviceSlaPolicies.responseMinutes,
      resolutionMinutes: serviceSlaPolicies.resolutionMinutes,
    }).from(serviceSlaPolicies)
      .where(and(
        eq(serviceSlaPolicies.priority, value.priority),
        eq(serviceSlaPolicies.isActive, true),
      ))
      .limit(1);
    const now = new Date();
    const deadlines = policy
      ? calculateServiceSlaDeadlines({ reportedAt: now, ...policy })
      : null;
    const [updated] = await tx.update(serviceCustomerRequests).set({
      title: value.title,
      description: value.description,
      contactName: value.contactName,
      contactPhone: value.contactPhone,
      priority: value.priority,
      status: "triaged",
      responseDueAt: deadlines?.responseDueAt ?? null,
      resolutionDueAt: deadlines?.resolutionDueAt ?? null,
      updatedAt: now,
    }).where(eq(serviceCustomerRequests.id, current.id))
      .returning({
        id: serviceCustomerRequests.id,
        code: serviceCustomerRequests.code,
        status: serviceCustomerRequests.status,
      });
    return updated;
  });
  if (!result) return mobileError("errors.notFound", 404);
  return mobileOk(result);
}
