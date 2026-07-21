import { db } from "@/db";
import { mobileTelemetryEvents } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { mobileTelemetrySchema } from "@/lib/telemetry/mobile";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  const parsed = mobileTelemetrySchema.safeParse(body);
  if (!parsed.success) return mobileError("errors.invalidData", 400);

  const event = parsed.data;
  await db.insert(mobileTelemetryEvents).values({
    userId: gate.userId,
    eventType: event.eventType,
    platform: event.platform,
    appVersion: event.appVersion,
    ...(event.eventType === "app_error"
      ? { errorType: event.errorType, fingerprint: event.fingerprint }
      : event.eventType === "performance"
        ? {
            metric: event.metric,
            screen: event.screen,
            durationMs: event.durationMs,
            success: event.success,
          }
        : {
            metric: "sync_run",
            screen: "offline_sync",
            durationMs: event.durationMs,
            attemptedCount: event.attemptedCount,
            succeededCount: event.succeededCount,
            failedCount: event.failedCount,
            conflictCount: event.conflictCount,
            success: event.failedCount === 0 && event.conflictCount === 0,
          }),
  });

  return mobileOk({ accepted: true });
}
