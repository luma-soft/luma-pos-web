import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  cameraDeviceLinks,
  cameraHealthSnapshots,
  cameraVendorConnections,
  installedAssets,
} from "@/db/schema";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { recordActivity } from "@/lib/audit/activity-log";

const inputSchema = z.object({
  assetId: z.uuid(),
  vendor: z.enum(["ezviz", "hikvision", "dahua", "uniview"]),
  connectionName: z.string().trim().min(1).max(200),
  region: z.string().trim().max(40).optional(),
  externalDeviceId: z.string().trim().min(1).max(300),
  vendorAppUrl: z.string().trim().url().nullable().optional(),
});

export async function POST(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const parsed = inputSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const value = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [asset] = await tx.select({ id: installedAssets.id, name: installedAssets.name, projectId: installedAssets.projectId })
      .from(installedAssets)
      .where(and(eq(installedAssets.storeId, gate.storeId), eq(installedAssets.id, value.assetId)))
      .limit(1).for("update");
    if (!asset) return null;
    let [connection] = await tx.select({ id: cameraVendorConnections.id })
      .from(cameraVendorConnections)
      .where(and(
        eq(cameraVendorConnections.storeId, gate.storeId),
        eq(cameraVendorConnections.vendor, value.vendor),
        eq(cameraVendorConnections.name, value.connectionName),
      ))
      .limit(1);
    if (!connection) {
      [connection] = await tx.insert(cameraVendorConnections).values({
        storeId: gate.storeId,
        vendor: value.vendor,
        name: value.connectionName,
        region: value.region || null,
        status: "disabled",
        config: {},
        createdBy: gate.userId,
      }).returning({ id: cameraVendorConnections.id });
    }
    const [before] = await tx.select().from(cameraDeviceLinks).where(and(
      eq(cameraDeviceLinks.storeId, gate.storeId), eq(cameraDeviceLinks.assetId, value.assetId), eq(cameraDeviceLinks.connectionId, connection.id),
    )).limit(1);
    if (before && before.externalDeviceId === value.externalDeviceId && before.vendorAppUrl === (value.vendorAppUrl ?? null) && before.isActive) return before;
    const [link] = await tx.insert(cameraDeviceLinks).values({
      storeId: gate.storeId,
      connectionId: connection.id,
      assetId: value.assetId,
      externalDeviceId: value.externalDeviceId,
      vendorAppUrl: value.vendorAppUrl ?? null,
    }).onConflictDoUpdate({
      target: [cameraDeviceLinks.assetId, cameraDeviceLinks.connectionId],
      set: {
        externalDeviceId: value.externalDeviceId,
        vendorAppUrl: value.vendorAppUrl ?? null,
        isActive: true,
        updatedAt: new Date(),
      },
    }).returning();
    await recordActivity(tx, {
      storeId: gate.storeId, actorId: gate.userId, source: "mobile", action: before ? "service.vendor.device_link.updated" : "service.vendor.device_link.created",
      entityType: "installed_asset", entityId: asset.id,
      before: before ? { name: asset.name, vendor: value.vendor, connectionName: value.connectionName, isActive: before.isActive } : null,
      after: { name: asset.name, vendor: value.vendor, connectionName: value.connectionName, isActive: link.isActive },
      metadata: { projectId: asset.projectId, assetId: asset.id, assetName: asset.name, deviceIdentityChanged: before ? before.externalDeviceId !== value.externalDeviceId : false, appLinkChanged: before ? before.vendorAppUrl !== (value.vendorAppUrl ?? null) : false },
    });
    return link;
  });
  if (!result) return mobileError("errors.notFound", 404);
  return mobileOk(result);
}

export async function GET(request: Request) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const assetId = new URL(request.url).searchParams.get("assetId");
  if (!assetId) return mobileError("errors.invalidData", 400);
  const [link] = await db.select({
    id: cameraDeviceLinks.id,
    vendor: cameraVendorConnections.vendor,
    externalDeviceId: cameraDeviceLinks.externalDeviceId,
    vendorAppUrl: cameraDeviceLinks.vendorAppUrl,
    connectionStatus: cameraVendorConnections.status,
  }).from(cameraDeviceLinks)
    .innerJoin(
      cameraVendorConnections,
      eq(cameraDeviceLinks.connectionId, cameraVendorConnections.id),
    )
    .where(and(
      eq(cameraDeviceLinks.storeId, gate.storeId),
      eq(cameraVendorConnections.storeId, gate.storeId),
      eq(cameraDeviceLinks.assetId, assetId),
      eq(cameraDeviceLinks.isActive, true),
    ))
    .limit(1);
  if (!link) return mobileError("errors.notFound", 404);
  const [health] = await db.select({
    online: cameraHealthSnapshots.online,
    status: cameraHealthSnapshots.status,
    lastSeenAt: cameraHealthSnapshots.lastSeenAt,
    firmwareVersion: cameraHealthSnapshots.firmwareVersion,
    storageStatus: cameraHealthSnapshots.storageStatus,
    capturedAt: cameraHealthSnapshots.capturedAt,
  }).from(cameraHealthSnapshots)
    .where(and(eq(cameraHealthSnapshots.storeId, gate.storeId), eq(cameraHealthSnapshots.deviceLinkId, link.id)))
    .orderBy(desc(cameraHealthSnapshots.capturedAt))
    .limit(1);
  return mobileOk({ ...link, health: health ?? null });
}
