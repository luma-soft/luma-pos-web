import { createSign } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  mobilePushDevices,
  profiles,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import {
  notificationCategories,
  type NotificationCategory,
  type NotificationTarget,
} from "@/lib/notifications/contracts";
import {
  buildFcmMessage,
  classifyFcmFailure,
  type FcmFailure,
} from "@/lib/notifications/fcm-message";
import {
  resolveFirebaseServiceAccount,
  type FirebaseServiceAccount,
} from "@/lib/notifications/firebase-config";
import { deliverPushDeviceCore } from "@/lib/notifications/push-delivery";
import { isWithinQuietHours } from "@/lib/notifications/policy";
import type { StorePrefs } from "@/lib/schemas/settings";

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let accessTokenRefresh: Promise<string> | null = null;

class FirebaseAuthFailure extends Error {
  constructor(readonly result: FcmFailure) {
    super(result.code);
  }
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function refreshFirebaseAccessToken(account: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encode(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${encode(signer.sign(account.private_key))}`;
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FirebaseAuthFailure({
      kind: "retry",
      code: "FCM_AUTH_NETWORK",
    });
  }
  if (!response.ok) {
    const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
    if (response.status === 429) {
      throw new FirebaseAuthFailure({
        kind: "retry",
        code: "FCM_AUTH_RATE_LIMITED",
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    if (response.status >= 500) {
      throw new FirebaseAuthFailure({
        kind: "retry",
        code: "FCM_AUTH_UNAVAILABLE",
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    throw new FirebaseAuthFailure({
      kind: "permanent",
      code: `FCM_AUTH_${response.status}`,
    });
  }
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new FirebaseAuthFailure({
      kind: "permanent",
      code: "FCM_AUTH_INVALID",
    });
  }
  cachedAccessToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

async function firebaseAccessToken(account: FirebaseServiceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }
  if (accessTokenRefresh) return accessTokenRefresh;

  const refresh = refreshFirebaseAccessToken(account);
  accessTokenRefresh = refresh;
  try {
    return await refresh;
  } finally {
    if (accessTokenRefresh === refresh) accessTokenRefresh = null;
  }
}

export type PushCategory =
  | "lowStock"
  | "einvoiceError"
  | "shiftClose"
  | "syncDone"
  | "serviceDue";

type LegacyDeviceNotificationInput = {
  token: string;
  locale?: string | null;
  notificationKey: string;
  category: PushCategory;
  target: string;
  entityId?: string;
};

type EventDeviceNotificationInput = {
  token: string;
  locale?: string | null;
  eventId: string;
  notificationKey: string;
  category: NotificationCategory;
  target: NotificationTarget;
  entityId: string;
};

export type DeviceNotificationInput =
  | LegacyDeviceNotificationInput
  | EventDeviceNotificationInput;

export type DeviceNotificationResult = { kind: "sent" } | FcmFailure;

function isEventInput(
  input: DeviceNotificationInput,
): input is EventDeviceNotificationInput {
  return "eventId" in input
    && (notificationCategories as readonly string[]).includes(input.category);
}

function legacyFcmMessage(input: LegacyDeviceNotificationInput) {
  return {
    message: {
      token: input.token,
      notification: {
        title: "LumaPOS",
        body: input.locale?.toLowerCase().startsWith("en")
          ? "You have a new operational alert."
          : "Bạn có cảnh báo vận hành mới.",
      },
      data: {
        kind: "operational_alert",
        category: input.category,
        target: input.target,
        notificationKey: input.notificationKey,
        ...(input.entityId ? { entityId: input.entityId } : {}),
      },
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "5" },
        payload: { aps: { "content-available": 1 } },
      },
    },
  } as const;
}

function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

async function safeResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function sendNotificationToDevice(
  input: DeviceNotificationInput,
  signal?: AbortSignal,
): Promise<DeviceNotificationResult> {
  const account = resolveFirebaseServiceAccount();
  if (!account) return { kind: "permanent", code: "FCM_NOT_CONFIGURED" };

  try {
    const accessToken = await firebaseAccessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          isEventInput(input) ? buildFcmMessage(input) : legacyFcmMessage(input),
        ),
        signal: signal ?? AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) return { kind: "sent" };

    const failure = classifyFcmFailure(
      response.status,
      await safeResponseBody(response),
    );
    if (failure.kind !== "retry") return failure;
    return {
      ...failure,
      retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
    };
  } catch (error) {
    if (error instanceof FirebaseAuthFailure) return error.result;
    return { kind: "retry", code: "FCM_NETWORK" };
  }
}

export async function dispatchPushNotification(input: {
  notificationKey: string;
  category: PushCategory;
  target: string;
  entityId?: string;
  userIds?: string[];
  prefs: StorePrefs["notifications"];
}) {
  const account = resolveFirebaseServiceAccount();
  if (!account || !input.prefs.channels.push) {
    return { configured: Boolean(account), sent: 0, failed: 0, skipped: 0, deferred: 0 };
  }
  if (isWithinQuietHours({ now: new Date(), ...input.prefs.quietHours })) {
    return { configured: true, sent: 0, failed: 0, skipped: 1, deferred: 1 };
  }
  const roles = input.prefs.roleRouting[input.category] as Role[];
  const userIds = input.userIds?.filter(Boolean) ?? [];
  const effectiveProfiles = alias(profiles, "push_effective_profiles");
  const devices = await db.select({
    id: mobilePushDevices.id,
    token: mobilePushDevices.token,
    locale: mobilePushDevices.locale,
  }).from(mobilePushDevices)
    .innerJoin(profiles, eq(profiles.id, mobilePushDevices.userId))
    .innerJoin(
      effectiveProfiles,
      eq(effectiveProfiles.id, mobilePushDevices.effectiveUserId),
    )
    .where(and(
      eq(mobilePushDevices.enabled, true),
      userIds.length > 0
        ? inArray(effectiveProfiles.id, userIds)
        : inArray(effectiveProfiles.role, roles),
      eq(profiles.isActive, true),
      eq(effectiveProfiles.isActive, true),
    ));
  if (devices.length === 0) {
    return { configured: true, sent: 0, failed: 0, skipped: 0, deferred: 0 };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const device of devices) {
    const delivery = await deliverPushDeviceCore(db, {
      deviceId: device.id,
      notificationKey: input.notificationKey,
      send: async (signal) => {
        const result = await sendNotificationToDevice({
          token: device.token,
          locale: device.locale,
          notificationKey: input.notificationKey,
          category: input.category,
          target: input.target,
          entityId: input.entityId,
        }, signal);
        if (result.kind === "disable-token") {
          await db.update(mobilePushDevices)
            .set({ enabled: false, updatedAt: sql`now()` })
            .where(and(
              eq(mobilePushDevices.id, device.id),
              eq(mobilePushDevices.token, device.token),
            ));
        }
        return result.kind === "sent"
          ? { ok: true }
          : { ok: false, errorCode: result.code };
      },
    });
    if (delivery.outcome === "sent") sent++;
    else if (delivery.outcome === "failed") failed++;
    else skipped++;
  }
  return { configured: true, sent, failed, skipped, deferred: 0 };
}
