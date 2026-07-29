import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cameraDeviceAlerts,
  cameraDeviceLinks,
  cameraHealthSnapshots,
  cameraSyncRuns,
  cameraVendorConnections,
} from "@/db/schema";
import { cameraVendorAdapterFromEnv } from "@/lib/camera-vendors/adapter";

function redactedError(error: unknown) {
  const message = error instanceof Error ? error.message : "CAMERA_VENDOR_UNKNOWN";
  return message.startsWith("CAMERA_VENDOR_")
    ? message.slice(0, 120)
    : "CAMERA_VENDOR_FAILED";
}

export async function syncCameraDeviceLink(deviceLinkId: string) {
  const [link] = await db.select({
    id: cameraDeviceLinks.id,
    connectionId: cameraDeviceLinks.connectionId,
    externalDeviceId: cameraDeviceLinks.externalDeviceId,
    vendor: cameraVendorConnections.vendor,
  }).from(cameraDeviceLinks)
    .innerJoin(
      cameraVendorConnections,
      eq(cameraDeviceLinks.connectionId, cameraVendorConnections.id),
    )
    .where(eq(cameraDeviceLinks.id, deviceLinkId))
    .limit(1);
  if (!link) throw new Error("CAMERA_DEVICE_LINK_NOT_FOUND");
  const [run] = await db.insert(cameraSyncRuns).values({
    connectionId: link.connectionId,
    status: "running",
  }).returning({ id: cameraSyncRuns.id });
  const adapter = cameraVendorAdapterFromEnv();
  if (adapter.vendor !== link.vendor) {
    const code = "CAMERA_VENDOR_NOT_CONFIGURED";
    await db.update(cameraSyncRuns).set({
      status: "failed",
      errorCode: code,
      errorMessage: code,
      finishedAt: new Date(),
    }).where(eq(cameraSyncRuns.id, run.id));
    throw new Error(code);
  }
  try {
    const [health, alerts] = await Promise.all([
      adapter.getDeviceHealth(link.externalDeviceId),
      adapter.listDeviceAlerts(link.externalDeviceId),
    ]);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(cameraHealthSnapshots).values({
        deviceLinkId: link.id,
        online: health.online,
        status: health.status,
        lastSeenAt: health.lastSeenAt ? new Date(health.lastSeenAt) : null,
        firmwareVersion: health.firmwareVersion,
        storageStatus: health.storageStatus,
        capturedAt: now,
        rawHash: createHash("sha256").update(JSON.stringify(health)).digest("hex"),
      });
      for (const alert of alerts) {
        await tx.insert(cameraDeviceAlerts).values({
          deviceLinkId: link.id,
          externalAlertId: alert.externalAlertId,
          alertType: alert.alertType,
          severity: alert.severity,
          message: alert.message,
          occurredAt: new Date(alert.occurredAt),
          resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt) : null,
        }).onConflictDoUpdate({
          target: [
            cameraDeviceAlerts.deviceLinkId,
            cameraDeviceAlerts.externalAlertId,
          ],
          set: {
            severity: alert.severity,
            message: alert.message,
            resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt) : null,
          },
        });
      }
      await tx.update(cameraSyncRuns).set({
        status: "succeeded",
        deviceCount: 1,
        alertCount: alerts.length,
        finishedAt: now,
      }).where(eq(cameraSyncRuns.id, run.id));
      await tx.update(cameraVendorConnections).set({
        status: "active",
        lastSyncedAt: now,
        updatedAt: now,
      }).where(eq(cameraVendorConnections.id, link.connectionId));
    });
    return { runId: run.id, health, alertCount: alerts.length };
  } catch (error) {
    const code = redactedError(error);
    await db.update(cameraSyncRuns).set({
      status: "failed",
      errorCode: code,
      errorMessage: code,
      finishedAt: new Date(),
    }).where(eq(cameraSyncRuns.id, run.id));
    await db.update(cameraVendorConnections).set({
      status: "error",
      updatedAt: new Date(),
    }).where(eq(cameraVendorConnections.id, link.connectionId));
    throw new Error(code);
  }
}
