import { createSign } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  mobilePushDeliveries,
  mobilePushDevices,
  profiles,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import type { StorePrefs } from "@/lib/schemas/settings";
import { isWithinQuietHours } from "@/lib/notifications/policy";
import {
  resolveFirebaseServiceAccount,
  type FirebaseServiceAccount,
} from "@/lib/notifications/firebase-config";

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function firebaseAccessToken(account: FirebaseServiceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`FCM_AUTH_${response.status}`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("FCM_AUTH_INVALID");
  cachedAccessToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

export type PushCategory = "lowStock" | "einvoiceError" | "shiftClose" | "syncDone";

export async function dispatchPushNotification(input: {
  notificationKey: string;
  category: PushCategory;
  target: string;
  entityId?: string;
  prefs: StorePrefs["notifications"];
}) {
  const account = resolveFirebaseServiceAccount();
  if (!account || !input.prefs.channels.push) {
    return { configured: Boolean(account), sent: 0, failed: 0, skipped: 0 };
  }
  if (isWithinQuietHours({ now: new Date(), ...input.prefs.quietHours })) {
    return { configured: true, sent: 0, failed: 0, skipped: 1 };
  }
  const roles = input.prefs.roleRouting[input.category] as Role[];
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
      inArray(effectiveProfiles.role, roles),
      eq(profiles.isActive, true),
      eq(effectiveProfiles.isActive, true),
    ));
  if (devices.length === 0) {
    return { configured: true, sent: 0, failed: 0, skipped: 0 };
  }

  const accessToken = await firebaseAccessToken(account);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const device of devices) {
    const [previous] = await db.select({ status: mobilePushDeliveries.status })
      .from(mobilePushDeliveries)
      .where(and(
        eq(mobilePushDeliveries.deviceId, device.id),
        eq(mobilePushDeliveries.notificationKey, input.notificationKey),
      )).limit(1);
    if (previous?.status === "sent") {
      skipped++;
      continue;
    }

    let status = "failed";
    let errorCode: string | null = null;
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: {
                title: "LumaPOS",
                body: device.locale?.toLowerCase().startsWith("en")
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
          }),
        },
      );
      if (response.ok) {
        status = "sent";
        sent++;
      } else {
        errorCode = `FCM_${response.status}`;
        failed++;
        if (response.status === 404) {
          await db.update(mobilePushDevices).set({ enabled: false, updatedAt: sql`now()` })
            .where(eq(mobilePushDevices.id, device.id));
        }
      }
    } catch (error) {
      errorCode = error instanceof Error && error.message.startsWith("FCM_")
        ? error.message.slice(0, 80)
        : "FCM_NETWORK";
      failed++;
    }
    await db.insert(mobilePushDeliveries).values({
      deviceId: device.id,
      notificationKey: input.notificationKey,
      status,
      errorCode,
    }).onConflictDoUpdate({
      target: [
        mobilePushDeliveries.deviceId,
        mobilePushDeliveries.notificationKey,
      ],
      set: {
        status,
        errorCode,
        attempts: sql`${mobilePushDeliveries.attempts} + 1`,
        attemptedAt: sql`now()`,
      },
    });
  }
  return { configured: true, sent, failed, skipped };
}
