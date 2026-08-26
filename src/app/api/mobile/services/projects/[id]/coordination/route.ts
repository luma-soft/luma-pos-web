import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  profiles,
  projects,
  serviceCoordinationPoints,
  serviceJobAssignments,
  serviceJobDependencies,
  serviceJobs,
} from "@/db/schema";
import { requireMobileServiceManager, requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  serviceCoordinationPointSchema,
  serviceJobDependencySchema,
} from "@/lib/services/project-specialized-schemas";

type RouteContext = { params: Promise<{ id: string }> };

async function loadMixedProject(storeId: string, projectId: string) {
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.storeId, storeId),
    eq(projects.id, projectId),
    eq(projects.serviceType, "mixed"),
  )).limit(1);
  return project ?? null;
}

async function canViewMixedProject(
  storeId: string,
  projectId: string,
  userId: string,
  role: string,
) {
  if (role === "owner" || role === "manager") return true;
  if (role !== "technician") return false;
  const [assignedJob] = await db.select({ id: serviceJobs.id })
    .from(serviceJobs)
    .leftJoin(serviceJobAssignments, and(
      eq(serviceJobAssignments.jobId, serviceJobs.id),
      eq(serviceJobAssignments.storeId, storeId),
      eq(serviceJobAssignments.profileId, userId),
      isNull(serviceJobAssignments.removedAt),
    ))
    .where(and(
      eq(serviceJobs.storeId, storeId),
      eq(serviceJobs.projectId, projectId),
      or(
        eq(serviceJobs.assignedTo, userId),
        eq(serviceJobAssignments.profileId, userId),
      ),
    ))
    .limit(1);
  return Boolean(assignedJob);
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceAccess();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  if (!await loadMixedProject(gate.storeId, id)) return mobileError("errors.notFound", 404);
  if (!await canViewMixedProject(gate.storeId, id, gate.userId, gate.role)) {
    return mobileError("errors.forbidden", 403);
  }
  const [points, dependencies] = await Promise.all([
    db.select({
      id: serviceCoordinationPoints.id,
      title: serviceCoordinationPoints.title,
      locationLabel: serviceCoordinationPoints.locationLabel,
      serviceTypes: serviceCoordinationPoints.serviceTypes,
      status: serviceCoordinationPoints.status,
      description: serviceCoordinationPoints.description,
      assignedTo: serviceCoordinationPoints.assignedTo,
      assignedToName: profiles.fullName,
      dueAt: serviceCoordinationPoints.dueAt,
      isAcceptanceRequired: serviceCoordinationPoints.isAcceptanceRequired,
      createdAt: serviceCoordinationPoints.createdAt,
    }).from(serviceCoordinationPoints)
      .leftJoin(profiles, eq(serviceCoordinationPoints.assignedTo, profiles.id))
      .where(and(
        eq(serviceCoordinationPoints.storeId, gate.storeId),
        eq(serviceCoordinationPoints.projectId, id),
      )),
    db.select().from(serviceJobDependencies).where(and(
      eq(serviceJobDependencies.storeId, gate.storeId),
      eq(serviceJobDependencies.projectId, id),
    )),
  ]);
  return mobileOk({ points, dependencies });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  if (!await loadMixedProject(gate.storeId, id)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const kind = "kind" in body ? String(body.kind) : "point";
  if (kind === "dependency") {
    const parsed = serviceJobDependencySchema.safeParse({ ...body, projectId: id });
    if (!parsed.success) return mobileError("errors.invalidData");
    const jobs = await db.select({ id: serviceJobs.id }).from(serviceJobs).where(and(
      eq(serviceJobs.storeId, gate.storeId),
      eq(serviceJobs.projectId, id),
    ));
    const jobIds = new Set(jobs.map((job) => job.id));
    if (!jobIds.has(parsed.data.predecessorJobId) || !jobIds.has(parsed.data.successorJobId)) {
      return mobileError("services.errors.relationMismatch", 409);
    }
    const [dependency] = await db.insert(serviceJobDependencies).values({
      storeId: gate.storeId,
      ...parsed.data,
      note: parsed.data.note || null,
      createdBy: gate.userId,
    }).returning();
    await audit(gate.storeId, gate.userId, "service.coordination.dependency_created", dependency.id, id);
    return mobileOk(dependency);
  }
  const parsed = serviceCoordinationPointSchema.safeParse({ ...body, projectId: id });
  if (!parsed.success) return mobileError("errors.invalidData");
  if (parsed.data.assignedTo) {
    const [assignee] = await db.select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.storeId, gate.storeId),
      eq(profiles.id, parsed.data.assignedTo),
      eq(profiles.isActive, true),
      inArray(profiles.role, ["owner", "manager", "technician"]),
    )).limit(1);
    if (!assignee) return mobileError("errors.invalidData");
  }
  const [point] = await db.insert(serviceCoordinationPoints).values({
    storeId: gate.storeId,
    projectId: id,
    title: parsed.data.title,
    locationLabel: parsed.data.locationLabel || null,
    serviceTypes: parsed.data.serviceTypes,
    status: parsed.data.status,
    description: parsed.data.description || null,
    assignedTo: parsed.data.assignedTo ?? null,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    isAcceptanceRequired: parsed.data.isAcceptanceRequired,
    createdBy: gate.userId,
  }).returning();
  await audit(gate.storeId, gate.userId, "service.coordination.point_created", point.id, id);
  return mobileOk(point);
}

async function audit(
  storeId: string,
  actorId: string,
  action: string,
  entityId: string,
  projectId: string,
) {
  await db.insert(auditLogs).values({
    storeId,
    actorId,
    source: "mobile",
    action,
    entityType: "service_coordination",
    entityId,
    metadata: { projectId },
  });
}
