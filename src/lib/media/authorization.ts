import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  aiChatSessions,
  products,
  projects,
  serviceJobAssignments,
  serviceJobs,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import type { MediaPurpose } from "@/lib/media/schemas";
import type { StoreFeatureSet } from "@/lib/tenancy/store-features";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";

export type MediaActor = {
  storeId: string;
  userId: string;
  role: Role;
  features: StoreFeatureSet;
};

export type MediaTargetAuthorization = "allowed" | "forbidden" | "not_found";

export type AuthorizeMediaTarget = (input: {
  actor: MediaActor;
  purpose: MediaPurpose;
  targetId: string;
}) => Promise<MediaTargetAuthorization>;

const STOCK_ROLES: readonly Role[] = ["owner", "manager", "warehouse"];
const PROJECT_ROLES: readonly Role[] = ["owner", "manager", "cashier"];

export type MediaAuthorizationRepository = {
  productExists(storeId: string, productId: string): Promise<boolean>;
  getProject(
    storeId: string,
    projectId: string,
  ): Promise<{ serviceType: string | null } | null>;
  technicianCanAccessProject(
    storeId: string,
    projectId: string,
    userId: string,
  ): Promise<boolean>;
  getServiceJob(
    storeId: string,
    jobId: string,
  ): Promise<{ assignedTo: string | null } | null>;
  technicianAssignedToJob(jobId: string, userId: string): Promise<boolean>;
  ownsAiSession(storeId: string, sessionId: string, userId: string): Promise<boolean>;
};

const databaseAuthorizationRepository: MediaAuthorizationRepository = {
  async productExists(storeId, productId) {
    const [product] = await db.select({ id: products.id })
      .from(products)
      .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
      .limit(1);
    return Boolean(product);
  },
  async getProject(storeId, projectId) {
    const [project] = await db.select({ serviceType: projects.serviceType })
      .from(projects)
      .where(and(eq(projects.storeId, storeId), eq(projects.id, projectId)))
      .limit(1);
    return project ?? null;
  },
  async technicianCanAccessProject(storeId, projectId, userId) {
    const [accessibleJob] = await db.select({ id: serviceJobs.id })
      .from(serviceJobs)
      .where(and(
        eq(serviceJobs.storeId, storeId),
        eq(serviceJobs.projectId, projectId),
        or(
          eq(serviceJobs.assignedTo, userId),
          sql`exists (
            select 1 from ${serviceJobAssignments}
            where ${serviceJobAssignments.jobId} = ${serviceJobs.id}
              and ${serviceJobAssignments.profileId} = ${userId}
              and ${serviceJobAssignments.removedAt} is null
          )`,
        ),
      ))
      .limit(1);
    return Boolean(accessibleJob);
  },
  async getServiceJob(storeId, jobId) {
    const [job] = await db.select({ assignedTo: serviceJobs.assignedTo })
      .from(serviceJobs)
      .where(and(eq(serviceJobs.storeId, storeId), eq(serviceJobs.id, jobId)))
      .limit(1);
    return job ?? null;
  },
  async technicianAssignedToJob(jobId, userId) {
    const [assignment] = await db.select({ id: serviceJobAssignments.id })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.jobId, jobId),
        eq(serviceJobAssignments.profileId, userId),
        isNull(serviceJobAssignments.removedAt),
      )).limit(1);
    return Boolean(assignment);
  },
  async ownsAiSession(storeId, sessionId, userId) {
    const [session] = await db.select({ id: aiChatSessions.id })
      .from(aiChatSessions)
      .where(and(
        eq(aiChatSessions.storeId, storeId),
        eq(aiChatSessions.id, sessionId),
        eq(aiChatSessions.ownerId, userId),
        isNull(aiChatSessions.deletedAt),
      )).limit(1);
    return Boolean(session);
  },
};

export function createMediaTargetAuthorizer(
  repository: MediaAuthorizationRepository,
): AuthorizeMediaTarget {
  return async ({ actor, purpose, targetId }) => {
    switch (purpose) {
      case "product-image": {
        if (!STOCK_ROLES.includes(actor.role)) return "forbidden";
        // The store ID is the explicit staging target for an image uploaded
        // before its product row exists. Other UUIDs must be tenant products.
        if (targetId === actor.storeId) return "allowed";
        return await repository.productExists(actor.storeId, targetId)
          ? "allowed"
          : "not_found";
      }
      case "project-document": {
        const project = await repository.getProject(actor.storeId, targetId);
        if (!project) return "not_found";
        if (!project.serviceType) {
          return PROJECT_ROLES.includes(actor.role) ? "allowed" : "forbidden";
        }
        if (!storeFeatureEnabled(actor.features, "field_services")) return "forbidden";
        if (actor.role === "owner" || actor.role === "manager") return "allowed";
        if (actor.role !== "technician") return "forbidden";
        return await repository.technicianCanAccessProject(
          actor.storeId,
          targetId,
          actor.userId,
        ) ? "allowed" : "forbidden";
      }
      case "service-evidence": {
        if (!storeFeatureEnabled(actor.features, "field_services")) return "forbidden";
        const job = await repository.getServiceJob(actor.storeId, targetId);
        if (!job) return "not_found";
        if (actor.role === "owner" || actor.role === "manager") return "allowed";
        if (actor.role !== "technician") return "forbidden";
        if (job.assignedTo === actor.userId) return "allowed";
        return await repository.technicianAssignedToJob(targetId, actor.userId)
          ? "allowed"
          : "forbidden";
      }
      case "ai-attachment": {
        if (!storeFeatureEnabled(actor.features, "ai_assistant")) return "forbidden";
        return await repository.ownsAiSession(actor.storeId, targetId, actor.userId)
          ? "allowed"
          : "not_found";
      }
    }
  };
}

export const authorizeMediaTarget = createMediaTargetAuthorizer(
  databaseAuthorizationRepository,
);
