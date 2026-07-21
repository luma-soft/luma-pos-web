import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { ActionResult, Role } from "@/lib/actions/common";
import { writeAuditLog, type AuditSource } from "@/lib/audit";
import {
  canApplyStaffSettingsMutation,
  type StaffSettingsMutation,
} from "@/lib/settings/staff-settings-mutation";

type StaffMutationResult = ActionResult<{ id: string }>;

export async function applyStaffSettingsMutation(input: {
  actorId: string;
  actorRole: Role;
  mutation: StaffSettingsMutation;
  source: Extract<AuditSource, "manual" | "mobile">;
}): Promise<StaffMutationResult> {
  try {
    const outcome = await db.transaction(async (tx) => {
      // Lock active owners in a stable order so concurrent demotions cannot
      // both observe another owner and remove the final privileged account.
      const activeOwners = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.role, "owner"), eq(profiles.isActive, true)))
        .orderBy(profiles.id)
        .for("update");
      const [target] = await tx
        .select({
          id: profiles.id,
          role: profiles.role,
          isActive: profiles.isActive,
        })
        .from(profiles)
        .where(eq(profiles.id, input.mutation.id))
        .limit(1);
      if (!target) return { status: "not_found" } as const;

      if (
        !canApplyStaffSettingsMutation(
          {
            actorId: input.actorId,
            actorRole: input.actorRole,
            activeOwnerCount: activeOwners.length,
            targetActive: target.isActive,
            targetId: target.id,
            targetRole: target.role,
          },
          input.mutation,
        )
      ) {
        return { status: "forbidden" } as const;
      }

      if (input.mutation.action === "role") {
        await tx
          .update(profiles)
          .set({ role: input.mutation.role })
          .where(eq(profiles.id, target.id));
      } else {
        await tx
          .update(profiles)
          .set({ isActive: input.mutation.active })
          .where(eq(profiles.id, target.id));
      }
      return {
        status: "updated",
        before: { role: target.role, active: target.isActive },
        after:
          input.mutation.action === "role"
            ? { role: input.mutation.role, active: target.isActive }
            : { role: target.role, active: input.mutation.active },
      } as const;
    });

    if (outcome.status === "not_found") {
      return { ok: false, error: "errors.notFound" };
    }
    if (outcome.status === "forbidden") {
      return { ok: false, error: "errors.forbidden" };
    }

    await writeAuditLog({
      actorId: input.actorId,
      source: input.source,
      action: `settings.staff_${input.mutation.action}_updated`,
      entityType: "profile",
      entityId: input.mutation.id,
      status: "succeeded",
      before: outcome.before,
      after: outcome.after,
    });
    return { ok: true, data: { id: input.mutation.id } };
  } catch (error) {
    console.error("applyStaffSettingsMutation failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}
