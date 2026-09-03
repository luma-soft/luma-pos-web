import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  projects,
  serviceCoordinationPoints,
  serviceJobAssignments,
  serviceJobDependencies,
  serviceJobs,
} from "@/db/schema";
import { requireMobileServiceManager, requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { recordActivity } from "@/lib/audit/activity-log";
import { activityValuesEqual } from "@/lib/products/product-activity";
import {
  serviceCoordinationUpdateSchema,
  serviceCoordinationPointSchema,
  serviceJobDependencySchema,
} from "@/lib/services/project-specialized-schemas";

type RouteContext = { params: Promise<{ id: string }> };

async function loadMixedProject(storeId: string, projectId: string) {
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(
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
  const project = await loadMixedProject(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileError("errors.invalidData");
  const kind = "kind" in body ? String(body.kind) : "point";
  if (kind === "dependency") {
    const parsed = serviceJobDependencySchema.safeParse({ ...body, projectId: id });
    if (!parsed.success) return mobileError("errors.invalidData");
    const jobs = await db.select({ id: serviceJobs.id, name: serviceJobs.title, code: serviceJobs.code }).from(serviceJobs).where(and(
      eq(serviceJobs.storeId, gate.storeId),
      eq(serviceJobs.projectId, id),
    ));
    const jobIds = new Set(jobs.map((job) => job.id));
    if (!jobIds.has(parsed.data.predecessorJobId) || !jobIds.has(parsed.data.successorJobId)) {
      return mobileError("services.errors.relationMismatch", 409);
    }
    const dependency = await db.transaction(async (tx) => {
      const [dependency] = await tx.insert(serviceJobDependencies).values({
        storeId: gate.storeId,
        ...parsed.data,
        note: parsed.data.note || null,
        createdBy: gate.userId,
      }).returning();
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, source: "mobile", action: "service.coordination.dependency_created", entityType: "service_coordination", entityId: dependency.id,
        after: dependencySnapshot(dependency), metadata: { projectId: id, projectName: project.name },
        affectedRecords: jobs.filter((job) => [dependency.predecessorJobId, dependency.successorJobId].includes(job.id)).map((job) => ({ type: "service_job", ...job })),
    });
    return dependency;
    });
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
  const point = await db.transaction(async (tx) => {
    const [point] = await tx.insert(serviceCoordinationPoints).values({
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
    await recordActivity(tx, {
      storeId: gate.storeId, actorId: gate.userId, source: "mobile", action: "service.coordination.point_created", entityType: "service_coordination", entityId: point.id,
      after: pointSnapshot(point), metadata: { projectId: id, projectName: project.name },
  });
  return point;
  });
  return mobileOk(point);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireMobileServiceManager();
  if (!gate.ok) return mobileGate(gate);
  const { id } = await params;
  const project = await loadMixedProject(gate.storeId, id);
  if (!project) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  const parsed = serviceCoordinationUpdateSchema.safeParse(body);
  if (!parsed.success) return mobileError("errors.invalidData");

  if (parsed.data.kind === "dependency") {
    const value = parsed.data;
    const dependency = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(serviceJobDependencies).where(and(
        eq(serviceJobDependencies.storeId, gate.storeId), eq(serviceJobDependencies.projectId, id), eq(serviceJobDependencies.id, value.id),
      )).limit(1).for("update");
      if (!before) return null;
      const [dependency] = await tx.update(serviceJobDependencies).set({
        status: value.status,
        ...(value.dependencyType !== undefined
          ? { dependencyType: value.dependencyType }
          : {}),
        ...(value.note !== undefined ? { note: value.note || null } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(serviceJobDependencies.storeId, gate.storeId),
        eq(serviceJobDependencies.projectId, id),
        eq(serviceJobDependencies.id, value.id),
      )).returning();
      if (!activityValuesEqual(dependencySnapshot(before), dependencySnapshot(dependency))) await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, source: "mobile", action: "service.coordination.dependency_updated", entityType: "service_coordination", entityId: dependency.id,
        before: dependencySnapshot(before), after: dependencySnapshot(dependency), metadata: { projectId: id, projectName: project.name },
    });
    return dependency;
    });
    if (!dependency) return mobileError("errors.notFound", 404);
    return mobileOk(dependency);
  }

  if (parsed.data.assignedTo) {
    const [assignee] = await db.select({ id: profiles.id }).from(profiles).where(and(
      eq(profiles.storeId, gate.storeId),
      eq(profiles.id, parsed.data.assignedTo),
      eq(profiles.isActive, true),
      inArray(profiles.role, ["owner", "manager", "technician"]),
    )).limit(1);
    if (!assignee) return mobileError("errors.invalidData");
  }
  const value = parsed.data;
  const point = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(serviceCoordinationPoints).where(and(
      eq(serviceCoordinationPoints.storeId, gate.storeId), eq(serviceCoordinationPoints.projectId, id), eq(serviceCoordinationPoints.id, value.id),
    )).limit(1).for("update");
    if (!before) return null;
    const [point] = await tx.update(serviceCoordinationPoints).set({
      status: value.status,
      ...(value.title !== undefined ? { title: value.title } : {}),
      ...(value.locationLabel !== undefined
        ? { locationLabel: value.locationLabel || null }
        : {}),
      ...(value.serviceTypes !== undefined
        ? { serviceTypes: value.serviceTypes }
        : {}),
      ...(value.description !== undefined
        ? { description: value.description || null }
        : {}),
      ...(value.assignedTo !== undefined
        ? { assignedTo: value.assignedTo }
        : {}),
      ...(value.dueAt !== undefined
        ? { dueAt: value.dueAt ? new Date(value.dueAt) : null }
        : {}),
      ...(value.isAcceptanceRequired !== undefined
        ? { isAcceptanceRequired: value.isAcceptanceRequired }
        : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(serviceCoordinationPoints.storeId, gate.storeId),
      eq(serviceCoordinationPoints.projectId, id),
      eq(serviceCoordinationPoints.id, value.id),
    )).returning();
    if (!activityValuesEqual(pointSnapshot(before), pointSnapshot(point))) await recordActivity(tx, {
      storeId: gate.storeId, actorId: gate.userId, source: "mobile", action: "service.coordination.point_updated", entityType: "service_coordination", entityId: point.id,
      before: pointSnapshot(before), after: pointSnapshot(point), metadata: { projectId: id, projectName: project.name },
  });
  return point;
  });
  if (!point) return mobileError("errors.notFound", 404);
  return mobileOk(point);
}

function dependencySnapshot(row: typeof serviceJobDependencies.$inferSelect) {
  return { status: row.status, dependencyType: row.dependencyType, note: row.note, predecessorJobId: row.predecessorJobId, successorJobId: row.successorJobId };
}

function pointSnapshot(row: typeof serviceCoordinationPoints.$inferSelect) {
  return { name: row.title, status: row.status, locationLabel: row.locationLabel, serviceTypes: row.serviceTypes, description: row.description, assignedTo: row.assignedTo, dueAt: row.dueAt?.toISOString() ?? null, isAcceptanceRequired: row.isAcceptanceRequired };
}
