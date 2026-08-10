import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, serviceCustomerRequestAttachments, serviceCustomerRequests, serviceJobs } from "@/db/schema";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { manageCustomerRequestCore } from "@/lib/services/customer-request-portal";
import { serviceCustomerRequestManageSchema } from "@/lib/services/schemas";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { id } = await params;
  const [row] = await db.select({
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
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .leftJoin(serviceJobs, eq(serviceCustomerRequests.linkedJobId, serviceJobs.id))
    .where(and(
      eq(serviceCustomerRequests.id, id),
      isNotNull(serviceCustomerRequests.submittedAt),
    )).limit(1);
  if (!row) return mobileError("errors.notFound", 404);
  const attachments = await db.select({
    id: serviceCustomerRequestAttachments.id,
    fileName: serviceCustomerRequestAttachments.fileName,
    mimeType: serviceCustomerRequestAttachments.mimeType,
    sizeBytes: serviceCustomerRequestAttachments.sizeBytes,
    width: serviceCustomerRequestAttachments.width,
    height: serviceCustomerRequestAttachments.height,
    sha256: serviceCustomerRequestAttachments.sha256,
    createdAt: serviceCustomerRequestAttachments.createdAt,
  }).from(serviceCustomerRequestAttachments)
    .where(eq(serviceCustomerRequestAttachments.requestId, id));
  return mobileOk({ ...row, attachments });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const parsed = serviceCustomerRequestManageSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const { id } = await params;
  try {
    const updated = await db.transaction((tx) => manageCustomerRequestCore(tx, {
      requestId: id,
      actorId: gate.userId,
      ...parsed.data,
    }));
    return mobileOk(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_FOUND") {
      return mobileError("errors.notFound", 404);
    }
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_JOB_MISMATCH") {
      return mobileError("services.errors.relationMismatch", 409);
    }
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_INVALID_TRANSITION") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_JOB_REQUIRED") {
      return mobileError("services.errors.relationMismatch", 409);
    }
    throw error;
  }
}
