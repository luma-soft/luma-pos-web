import { z } from "zod";

const common = {
  platform: z.enum(["android", "ios", "unknown"]),
  appVersion: z.string().trim().regex(/^\d+\.\d+\.\d+(?:\+\d+)?$/).max(32),
};

export const mobileTelemetrySchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("app_error"),
    ...common,
    errorType: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,80}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  }).strict(),
  z.object({
    eventType: z.literal("performance"),
    ...common,
    metric: z.enum(["app_bootstrap", "screen_load", "sync_run"]),
    screen: z.enum([
      "app", "dashboard", "pos", "inventory", "products", "customers",
      "reports", "settings", "offline_sync", "unknown",
    ]),
    durationMs: z.number().int().min(0).max(300_000),
    success: z.boolean(),
  }).strict(),
  z.object({
    eventType: z.literal("sync_result"),
    ...common,
    durationMs: z.number().int().min(0).max(300_000),
    attemptedCount: z.number().int().min(0).max(10_000),
    succeededCount: z.number().int().min(0).max(10_000),
    failedCount: z.number().int().min(0).max(10_000),
    conflictCount: z.number().int().min(0).max(10_000),
  }).strict(),
]);

export type MobileTelemetryEvent = z.infer<typeof mobileTelemetrySchema>;
