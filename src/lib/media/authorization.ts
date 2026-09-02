import { db } from "@/db";
import type { Role } from "@/lib/auth/roles";
import {
  createDatabaseMediaAuthorizationRepository,
  type MediaAuthorizationRepository,
} from "@/lib/media/authorization-repository";
import type { MediaPurpose } from "@/lib/media/schemas";
import {
  canonicalizeUuidCoordinate,
  uuidCoordinatesEqual,
} from "@/lib/media/uuid-coordinate";
import type { StoreFeatureSet } from "@/lib/tenancy/store-features";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";

export type MediaActor = {
  storeId: string;
  userId: string;
  role: Role;
  features: StoreFeatureSet;
};

export type MediaTargetAuthorization = "allowed" | "forbidden" | "not_found";

export function canonicalizeMediaActor(actor: MediaActor): MediaActor {
  return {
    ...actor,
    storeId: canonicalizeUuidCoordinate(actor.storeId),
    userId: canonicalizeUuidCoordinate(actor.userId),
  };
}

export type AuthorizeMediaTarget = (input: {
  actor: MediaActor;
  purpose: MediaPurpose;
  targetId: string;
}) => Promise<MediaTargetAuthorization>;

const STOCK_ROLES: readonly Role[] = ["owner", "manager", "warehouse"];
const PROJECT_ROLES: readonly Role[] = ["owner", "manager", "cashier"];

export type { MediaAuthorizationRepository } from "@/lib/media/authorization-repository";

const databaseAuthorizationRepository = createDatabaseMediaAuthorizationRepository(db);

export function createMediaTargetAuthorizer(
  repository: MediaAuthorizationRepository,
): AuthorizeMediaTarget {
  return async ({ actor: candidateActor, purpose, targetId: candidateTargetId }) => {
    const actor = canonicalizeMediaActor(candidateActor);
    const targetId = canonicalizeUuidCoordinate(candidateTargetId);
    switch (purpose) {
      case "product-image": {
        if (!STOCK_ROLES.includes(actor.role)) return "forbidden";
        // The store ID is the explicit staging target for an image uploaded
        // before its product row exists. Other UUIDs must be tenant products.
        if (uuidCoordinatesEqual(targetId, actor.storeId)) return "allowed";
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
        if (job.assignedTo && uuidCoordinatesEqual(job.assignedTo, actor.userId)) {
          return "allowed";
        }
        return await repository.technicianAssignedToJob(
          actor.storeId,
          targetId,
          actor.userId,
        )
          ? "allowed"
          : "forbidden";
      }
      case "ai-attachment": {
        if (!storeFeatureEnabled(actor.features, "ai_assistant")) return "forbidden";
        return await repository.ownsAiSession(actor.storeId, targetId, actor.userId)
          ? "allowed"
          : "not_found";
      }
      case "library-asset": {
        if (!uuidCoordinatesEqual(targetId, actor.storeId)) return "not_found";
        return actor.role === "owner" || actor.role === "manager"
          ? "allowed"
          : "forbidden";
      }
    }
  };
}

export const authorizeMediaTarget = createMediaTargetAuthorizer(
  databaseAuthorizationRepository,
);
