import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { getRawStorePrefs } from "@/lib/data/settings";
import { dispatchPushNotification } from "@/lib/notifications/push";
import { mobileError, mobileOk } from "@/lib/mobile/response";

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
  });
}
