import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { ActionResult, Role } from "@/lib/actions/common";
import type { AuditSource } from "@/lib/audit";
import { recordActivity } from "@/lib/audit/activity-log";
import {
  canApplyStaffSettingsMutation,
  type StaffSettingsMutation,
} from "@/lib/settings/staff-settings-mutation";

type StaffMutationResult = ActionResult<{ id: string }>;

export async function applyStaffSettingsMutation(input: {
  actorId: string;
  storeId: string;
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
        .where(and(
          eq(profiles.storeId, input.storeId),
          eq(profiles.role, "owner"),
          eq(profiles.isActive, true),
        ))
        .orderBy(profiles.id)
        .for("update");
      const [target] = await tx
        .select({
          id: profiles.id,
          name: profiles.fullName,
          role: profiles.role,
          isActive: profiles.isActive,
        })
        .from(profiles)
        .where(and(
          eq(profiles.id, input.mutation.id),
          eq(profiles.storeId, input.storeId),
        ))
        .limit(1).for("update");
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

      const before = { name: target.name, role: target.role, active: target.isActive };
      const after = input.mutation.action === "role"
        ? { ...before, role: input.mutation.role }
        : { ...before, active: input.mutation.active };
      if (before.role === after.role && before.active === after.active) return { status: "unchanged" } as const;
      if (input.mutation.action === "role") {
        await tx
          .update(profiles)
          .set({ role: input.mutation.role })
          .where(and(eq(profiles.id, target.id), eq(profiles.storeId, input.storeId)));
      } else {
        await tx
          .update(profiles)
          .set({ isActive: input.mutation.active })
          .where(and(eq(profiles.id, target.id), eq(profiles.storeId, input.storeId)));
      }
      await recordActivity(tx, {
        storeId: input.storeId, actorId: input.actorId, source: input.source,
        action: `settings.staff_${input.mutation.action}_updated`, entityType: "profile", entityId: target.id,
        before, after,
      });
      return { status: "updated" } as const;
    });

    if (outcome.status === "not_found") {
      return { ok: false, error: "errors.notFound" };
    }
    if (outcome.status === "forbidden") {
      return { ok: false, error: "errors.forbidden" };
    }

    return { ok: true, data: { id: input.mutation.id } };
  } catch (error) {
    console.error("applyStaffSettingsMutation failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}
