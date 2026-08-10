import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { einvoices, stores } from "@/db/schema";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { getRawStorePrefs } from "@/lib/data/settings";
import { dispatchPushNotification } from "@/lib/notifications/push";
import { isNotificationCronAuthorized } from "@/lib/notifications/cron-auth";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import { runMaintenanceWorker } from "@/lib/services/maintenance-worker";
import { drainCustomerRequestStorageCleanup } from "@/lib/services/customer-request-portal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  dispatchPendingWarrantyNotificationsCore,
} from "@/lib/services/technician-warranty";

function dateKey(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type OperationsDatabase = {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
};

type NotificationOperationsSummary = {
  pending: number;
  retry: number;
  dead: number;
  oldestDueAgeSeconds: number;
  fcmAcceptedLastHour: number;
  fcmFailedLastHour: number;
  qrP95FcmAcceptedMs: number | null;
};

function firstResultRow(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) {
    return (result[0] ?? {}) as Record<string, unknown>;
  }
  if (
    result
    && typeof result === "object"
    && "rows" in result
    && Array.isArray((result as { rows: unknown }).rows)
  ) {
    return ((result as { rows: unknown[] }).rows[0] ?? {}) as Record<string, unknown>;
  }
  return {};
}

function metricNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getNotificationOperationsSummary(
  database: OperationsDatabase = db,
  now = new Date(),
): Promise<NotificationOperationsSummary> {
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const result = await database.execute(sql`
    WITH qr_first_acceptance AS (
      SELECT
        events.id,
        events.created_at,
        min(deliveries.attempted_at) AS accepted_at
      FROM notification_events AS events
      INNER JOIN mobile_push_deliveries AS deliveries
        ON deliveries.notification_key = 'event:' || events.id::text
      WHERE events.category IN ('qrPaymentConfirmed', 'qrPaymentException')
        AND events.created_at >= ${hourStart}
        AND events.created_at <= ${now}
        AND deliveries.status = 'sent'
        AND deliveries.attempted_at >= events.created_at
        AND deliveries.attempted_at <= ${now}
      GROUP BY events.id, events.created_at
    )
    SELECT
      (
        SELECT count(*)::integer
        FROM notification_outbox
        WHERE status = 'pending'
      ) AS pending,
      (
        SELECT count(*)::integer
        FROM notification_outbox
        WHERE status = 'retry'
      ) AS retry,
      (
        SELECT count(*)::integer
        FROM notification_outbox
        WHERE status = 'dead'
      ) AS dead,
      coalesce((
        SELECT floor(extract(epoch FROM (${now}::timestamptz - min(available_at))))::integer
        FROM notification_outbox
        WHERE status IN ('pending', 'retry')
          AND available_at <= ${now}
      ), 0) AS "oldestDueAgeSeconds",
      (
        SELECT count(*)::integer
        FROM mobile_push_deliveries
        WHERE status = 'sent'
          AND attempted_at >= ${hourStart}
          AND attempted_at <= ${now}
      ) AS "fcmAcceptedLastHour",
      (
        SELECT count(*)::integer
        FROM mobile_push_deliveries
        WHERE status = 'failed'
          AND attempted_at >= ${hourStart}
          AND attempted_at <= ${now}
      ) AS "fcmFailedLastHour",
      (
        SELECT round((
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY extract(epoch FROM (accepted_at - created_at)) * 1000
          )
        )::numeric)::double precision
        FROM qr_first_acceptance
      ) AS "qrP95FcmAcceptedMs"
  `);
  const row = firstResultRow(result);

  return {
    pending: metricNumber(row.pending),
    retry: metricNumber(row.retry),
    dead: metricNumber(row.dead),
    oldestDueAgeSeconds: metricNumber(row.oldestDueAgeSeconds),
    fcmAcceptedLastHour: metricNumber(row.fcmAcceptedLastHour),
    fcmFailedLastHour: metricNumber(row.fcmFailedLastHour),
    qrP95FcmAcceptedMs: row.qrP95FcmAcceptedMs == null
      ? null
      : metricNumber(row.qrP95FcmAcceptedMs),
  };
}

export async function GET(request: Request) {
  if (!isNotificationCronAuthorized(request)) {
    return mobileError("errors.unauthorized", 401);
  }
  const activeStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.status, "active"));
  const prefsByStore = new Map(await Promise.all(activeStores.map(async (store) => [
    store.id,
    (await getRawStorePrefs(store.id)).notifications,
  ] as const)));
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
  const warrantyNotifications = await dispatchPendingWarrantyNotificationsCore({
    database: db,
    dispatch: (notification) => {
      const prefs = prefsByStore.get(notification.storeId);
      if (!prefs?.serviceDue) {
        return Promise.resolve({ configured: true, sent: 0, failed: 0, skipped: 1, deferred: 0 });
      }
      return dispatchPushNotification({
        storeId: notification.storeId,
        notificationKey: `service-warranty:${notification.id}`,
        category: "serviceDue",
        target: "services",
        entityId: notification.jobId ?? notification.claimId,
        prefs,
        userIds: [notification.recipientId],
      });
    },
  });
  results.push(...warrantyNotifications.deliveries);

  for (const occurrence of maintenance.results.filter((item) => item.created && item.jobId)) {
    if (!occurrence.storeId) continue;
    const prefs = prefsByStore.get(occurrence.storeId);
    if (!prefs?.serviceDue) continue;
    results.push(await dispatchPushNotification({
      storeId: occurrence.storeId,
      notificationKey: `service-due:${occurrence.jobId}`,
      category: "serviceDue",
      target: "services",
      entityId: occurrence.jobId!,
      prefs,
      userIds: occurrence.assignedTo ? [occurrence.assignedTo] : undefined,
    }));
  }
  for (const occurrence of maintenance.overdue) {
    const prefs = prefsByStore.get(occurrence.storeId);
    if (!prefs?.serviceDue) continue;
    results.push(await dispatchPushNotification({
      storeId: occurrence.storeId,
      notificationKey: occurrence.notificationKey,
      category: "serviceDue",
      target: "services",
      entityId: occurrence.jobId,
      prefs,
      userIds: occurrence.userIds,
    }));
  }

  for (const store of activeStores) {
    const prefs = prefsByStore.get(store.id)!;
    const day = dateKey(prefs.quietHours.timezone);
    if (prefs.lowStock) {
      const restock = await getRestockSuggestions(store.id, 30);
      const eligible = restock.filter((row) =>
        row.priority === "high"
        || (row.daysOfStock != null && row.daysOfStock <= prefs.thresholds.lowStockDays)
      );
      for (const row of eligible) {
        results.push(await dispatchPushNotification({
          storeId: store.id,
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
        .where(and(eq(einvoices.storeId, store.id), eq(einvoices.status, "error")));
      for (const row of failed.filter(
        (item) => item.attemptCount >= prefs.thresholds.einvoiceFailureAttempts,
      )) {
        results.push(await dispatchPushNotification({
          storeId: store.id,
          notificationKey: `einvoice-error:${row.id}:${day}`,
          category: "einvoiceError",
          target: "invoices",
          entityId: row.id,
          prefs,
        }));
      }
    }
  }

  const operations = await getNotificationOperationsSummary();
  return mobileOk({
    evaluated: results.length,
    sent: results.reduce((sum, result) => sum + result.sent, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    configured: results.every((result) => result.configured),
    maintenance,
    customerRequestStorageCleanup,
    warrantyNotifications: {
      evaluated: warrantyNotifications.evaluated,
      dispatched: warrantyNotifications.dispatched,
      deferred: warrantyNotifications.deferred,
      failed: warrantyNotifications.failed,
    },
    ...operations,
  });
}
