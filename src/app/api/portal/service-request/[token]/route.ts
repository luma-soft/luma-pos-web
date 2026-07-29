import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  serviceCustomerRequests,
  serviceSlaPolicies,
} from "@/db/schema";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";
import {
  consumePublicRateLimitCore,
  submitCustomerRequestCore,
} from "@/lib/services/customer-request-portal";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "@/lib/services/customer-request-token";
import { serviceCustomerRequestSubmitSchema } from "@/lib/services/schemas";

function clientIdentity(request: Request) {
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return ip.slice(0, 80);
}

async function rateLimit(request: Request, tokenHash: string, operation: "get" | "post") {
  const limit = operation === "get" ? 60 : 10;
  const windowSeconds = operation === "get" ? 3600 : 900;
  const keys = [
    `customer-request:${operation}:token:${tokenHash}`,
    ...(clientIdentity(request) === "unknown"
      ? []
      : [`customer-request:${operation}:ip:${clientIdentity(request)}`]),
  ];
  for (const key of keys) {
    const result = await db.transaction((tx) =>
      consumePublicRateLimitCore(tx, { key, limit, windowSeconds }));
    if (!result.allowed) return result;
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const tokenHash = hashCustomerRequestToken(token);
  const limited = await rateLimit(request, tokenHash, "get");
  if (limited) {
    return Response.json(
      { ok: false, error: "errors.rateLimited" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }
  const [row] = await db.select({
    code: serviceCustomerRequests.code,
    projectName: projects.name,
    title: serviceCustomerRequests.title,
    priority: serviceCustomerRequests.priority,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    responseDueAt: serviceCustomerRequests.responseDueAt,
    resolutionDueAt: serviceCustomerRequests.resolutionDueAt,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!row || !isCustomerRequestTokenViewable({ expiresAt: row.tokenExpiresAt })) {
    return mobileError("errors.notFound", 404);
  }
  return mobileOk({
    code: row.code,
    projectName: row.projectName,
    title: row.submittedAt ? row.title : null,
    priority: row.submittedAt ? row.priority : null,
    status: row.status,
    submittedAt: row.submittedAt,
    responseDueAt: row.responseDueAt,
    resolutionDueAt: row.resolutionDueAt,
    respondedAt: row.respondedAt,
    resolvedAt: row.resolvedAt,
    canSubmit: isCustomerRequestTokenSubmittable({
      status: row.status,
      submittedAt: row.submittedAt,
      expiresAt: row.tokenExpiresAt,
    }),
    expiresAt: row.tokenExpiresAt,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const tokenHash = hashCustomerRequestToken(token);
  const limited = await rateLimit(request, tokenHash, "post");
  if (limited) {
    return Response.json(
      { ok: false, error: "errors.rateLimited" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }
  const parsed = serviceCustomerRequestSubmitSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const [current] = await db.select({
    id: serviceCustomerRequests.id,
    priority: serviceCustomerRequests.priority,
  }).from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!current) return mobileError("errors.notFound", 404);
  const [policy] = await db.select({
    responseMinutes: serviceSlaPolicies.responseMinutes,
    resolutionMinutes: serviceSlaPolicies.resolutionMinutes,
  }).from(serviceSlaPolicies).where(and(
    eq(serviceSlaPolicies.priority, parsed.data.priority),
    eq(serviceSlaPolicies.isActive, true),
  )).limit(1);
  try {
    const result = await db.transaction((tx) => submitCustomerRequestCore(tx, {
      requestId: current.id,
      ...parsed.data,
      responseMinutes: policy?.responseMinutes ?? null,
      resolutionMinutes: policy?.resolutionMinutes ?? null,
    }));
    return mobileOk({
      code: result.code,
      status: result.status,
      responseDueAt: result.responseDueAt,
      resolutionDueAt: result.resolutionDueAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_SUBMITTABLE") {
      return mobileError("errors.notFound", 404);
    }
    throw error;
  }
}
