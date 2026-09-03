import { recordActivity } from "@/lib/audit/activity-log";
import { and, eq, sql } from "drizzle-orm";
import {
  installedAssets,
  serviceAttachments,
  serviceMaintenancePlans,
  warrantyClaims,
} from "@/db/schema";

type DatabaseLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function deleteInstalledAssetCore(
  database: DatabaseLike,
  input: { storeId: string; assetId: string; actorId?: string | null },
) {
  return database.transaction(async (tx: DatabaseLike) => {
    const scope = and(
      eq(installedAssets.storeId, input.storeId),
      eq(installedAssets.id, input.assetId),
    );
    const [asset] = await tx.select({
      id: installedAssets.id,
      name: installedAssets.name,
      projectId: installedAssets.projectId,
    }).from(installedAssets).where(scope).for("update").limit(1);
    if (!asset) return { outcome: "not_found" } as const;

    // Keep the device identity on service history and scheduled maintenance.
    // The asset lock also serializes inserts referencing this device.
    const [claim] = await tx.select({ id: warrantyClaims.id })
      .from(warrantyClaims).where(and(
        eq(warrantyClaims.storeId, input.storeId),
        eq(warrantyClaims.assetId, asset.id),
      )).limit(1);
    const [plan] = await tx.select({ id: serviceMaintenancePlans.id })
      .from(serviceMaintenancePlans).where(and(
        eq(serviceMaintenancePlans.storeId, input.storeId),
        eq(serviceMaintenancePlans.assetId, asset.id),
      )).limit(1);
    if (claim || plan) return { outcome: "linked" } as const;

    // Photos remain available as project evidence, including their storage
    // references. Removing a device never deletes shared media or changes stock.
    await tx.update(serviceAttachments).set({
      assetId: null,
      isPrimary: false,
      category: sql`case when ${serviceAttachments.category} = 'asset' then 'after' else ${serviceAttachments.category} end`,
      projectPhase: sql`case when ${serviceAttachments.category} = 'asset' then 'after_installation' else ${serviceAttachments.projectPhase} end`,
    }).where(and(
      eq(serviceAttachments.storeId, input.storeId),
      eq(serviceAttachments.assetId, asset.id),
    ));

    // Existing database guards enforce completed/cancelled job immutability
    // and invalidate affected signatures. Any rejection rolls back photo edits.
    await tx.delete(installedAssets).where(scope);
    await recordActivity(tx, { storeId: input.storeId, actorId: input.actorId ?? null,
      action: "service.asset.deleted", entityType: "installed_asset", entityId: asset.id,
      before: { name: asset.name }, metadata: { projectId: asset.projectId, deleted: true } });
    return { outcome: "deleted", projectId: asset.projectId as string } as const;
  });
}
