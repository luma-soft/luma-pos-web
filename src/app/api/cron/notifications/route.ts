import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { getRawStorePrefs } from "@/lib/data/settings";
import { dispatchPushNotification } from "@/lib/notifications/push";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import { runMaintenanceWorker } from "@/lib/services/maintenance-worker";
import { drainCustomerRequestStorageCleanup } from "@/lib/services/customer-request-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  claimWarrantyNotificationDeliveriesCore,
  completeWarrantyNotificationDeliveryCore,
} from "@/lib/services/technician-warranty";

function authorized(request: Request) {
  const expected = process.env.NOTIFICATION_CRON_SECRET?.trim() ?? "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function dateKey(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  if (!authorized(request)) return mobileError("errors.unauthorized", 401);
  const prefs = (await getRawStorePrefs()).notifications;
  const day = dateKey(prefs.quietHours.timezone);
  const results = [];
  const maintenance = await runMaintenanceWorker();
  const cleanupStorage = createSupabaseAdminClient();
  const customerRequestStorageCleanup = await drainCustomerRequestStorageCleanup({
    database: db,
    storage: {
      async remove(bucket, path) {
        const { error } = await cleanupStorage.storage.from(bucket).remove([path]);
        if (error) throw error;
      },
    },
  });
  const warrantyNotificationClaims = prefs.serviceDue
    ? await claimWarrantyNotificationDeliveriesCore(db)
    : [];
  let warrantyNotificationsDispatched = 0;
  let warrantyNotificationsFailed = 0;
  for (const notification of warrantyNotificationClaims) {
    const delivery = await dispatchPushNotification({
      notificationKey: `service-warranty:${notification.id}`,
      category: "serviceDue",
      target: "services",
      entityId: notification.jobId ?? notification.claimId,
      prefs,
      userIds: [notification.recipientId],
    });
    const delivered = delivery.configured && delivery.failed === 0;
    await completeWarrantyNotificationDeliveryCore(db, {
      id: notification.id,
      claimToken: notification.claimToken,
      delivered,
    });
    if (delivered) warrantyNotificationsDispatched++;
    else warrantyNotificationsFailed++;
    results.push(delivery);
  }

  if (prefs.serviceDue) {
    for (const occurrence of maintenance.results.filter((item) => item.created && item.jobId)) {
      results.push(await dispatchPushNotification({
        notificationKey: `service-due:${occurrence.jobId}`,
        category: "serviceDue",
        target: "services",
        entityId: occurrence.jobId!,
        prefs,
        userIds: occurrence.assignedTo ? [occurrence.assignedTo] : undefined,
      }));
    }
    for (const occurrence of maintenance.overdue) {
      results.push(await dispatchPushNotification({
        notificationKey: occurrence.notificationKey,
        category: "serviceDue",
        target: "services",
        entityId: occurrence.jobId,
        prefs,
        userIds: occurrence.userIds,
      }));
    }
  }

  if (prefs.lowStock) {
    const restock = await getRestockSuggestions(30);
    const eligible = restock.filter((row) =>
      row.priority === "high"
      || (row.daysOfStock != null && row.daysOfStock <= prefs.thresholds.lowStockDays)
    );
    for (const row of eligible) {
      results.push(await dispatchPushNotification({
        notificationKey: `low-stock:${row.id}:${day}`,
        category: "lowStock",
        target: "inventory",
        entityId: row.id,
        prefs,
      }));
    }
  }

  if (prefs.einvoiceError) {
    const failed = await db.select({
      id: einvoices.id,
      attemptCount: einvoices.attemptCount,
    })
      .from(einvoices)
      .where(eq(einvoices.status, "error"));
    for (const row of failed.filter(
      (item) => item.attemptCount >= prefs.thresholds.einvoiceFailureAttempts,
    )) {
      results.push(await dispatchPushNotification({
        notificationKey: `einvoice-error:${row.id}:${day}`,
        category: "einvoiceError",
        target: "invoices",
        entityId: row.id,
        prefs,
      }));
    }
  }

  return mobileOk({
    evaluated: results.length,
    sent: results.reduce((sum, result) => sum + result.sent, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    configured: results.every((result) => result.configured),
    maintenance,
    customerRequestStorageCleanup,
    warrantyNotifications: {
      evaluated: warrantyNotificationClaims.length,
      dispatched: warrantyNotificationsDispatched,
      failed: warrantyNotificationsFailed,
    },
  });
}
