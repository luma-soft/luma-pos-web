import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { db } from "@/db";
import {
  aiChatSessions,
  products,
  projects,
  serviceJobAssignments,
  serviceJobs,
} from "@/db/schema";

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
  technicianAssignedToJob(
    storeId: string,
    jobId: string,
    userId: string,
  ): Promise<boolean>;
  ownsAiSession(storeId: string, sessionId: string, userId: string): Promise<boolean>;
};

export function createDatabaseMediaAuthorizationRepository(
  database: Pick<typeof db, "select">,
): MediaAuthorizationRepository {
  return {
    async productExists(storeId, productId) {
      const [product] = await database.select({ id: products.id })
        .from(products)
        .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
        .limit(1);
      return Boolean(product);
    },
    async getProject(storeId, projectId) {
      const [project] = await database.select({ serviceType: projects.serviceType })
        .from(projects)
        .where(and(eq(projects.storeId, storeId), eq(projects.id, projectId)))
        .limit(1);
      return project ?? null;
    },
    async technicianCanAccessProject(storeId, projectId, userId) {
      const [accessibleJob] = await database.select({ id: serviceJobs.id })
        .from(serviceJobs)
        .where(and(
          eq(serviceJobs.storeId, storeId),
          eq(serviceJobs.projectId, projectId),
          or(
            eq(serviceJobs.assignedTo, userId),
            sql`exists (
              select 1 from ${serviceJobAssignments}
              where ${serviceJobAssignments.storeId} = ${storeId}
                and ${serviceJobAssignments.jobId} = ${serviceJobs.id}
                and ${serviceJobAssignments.profileId} = ${userId}
                and ${serviceJobAssignments.removedAt} is null
            )`,
          ),
        ))
        .limit(1);
      return Boolean(accessibleJob);
    },
    async getServiceJob(storeId, jobId) {
      const [job] = await database.select({ assignedTo: serviceJobs.assignedTo })
        .from(serviceJobs)
        .where(and(eq(serviceJobs.storeId, storeId), eq(serviceJobs.id, jobId)))
        .limit(1);
      return job ?? null;
    },
    async technicianAssignedToJob(storeId, jobId, userId) {
      const [assignment] = await database.select({ id: serviceJobAssignments.id })
        .from(serviceJobAssignments)
        .where(and(
          eq(serviceJobAssignments.storeId, storeId),
          eq(serviceJobAssignments.jobId, jobId),
          eq(serviceJobAssignments.profileId, userId),
          isNull(serviceJobAssignments.removedAt),
        )).limit(1);
      return Boolean(assignment);
    },
    async ownsAiSession(storeId, sessionId, userId) {
      const [session] = await database.select({ id: aiChatSessions.id })
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
}
