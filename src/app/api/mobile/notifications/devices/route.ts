import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mobilePushDevices } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { pushDeviceBinding } from "@/lib/notifications/device-binding";

const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(120),
  platform: z.enum(["android", "ios"]),
  token: z.string().trim().min(20).max(4096),
  permission: z.enum(["authorized", "provisional"]),
  locale: z.string().trim().max(20).optional(),
});

export async function GET() {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const binding = pushDeviceBinding(gate);
  const rows = await db.select({
    id: mobilePushDevices.id,
    deviceId: mobilePushDevices.deviceId,
    platform: mobilePushDevices.platform,
    permission: mobilePushDevices.permission,
    enabled: mobilePushDevices.enabled,
    lastSeenAt: mobilePushDevices.lastSeenAt,
  }).from(mobilePushDevices)
    .where(eq(mobilePushDevices.userId, binding.principalId));
  return mobileOk({ rows });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const parsed = deviceSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const device = parsed.data;
  const binding = pushDeviceBinding(gate);

  await db.transaction(async (tx) => {
    await tx.delete(mobilePushDevices)
      .where(eq(mobilePushDevices.token, device.token));
    await tx.insert(mobilePushDevices).values({
      userId: binding.principalId,
      effectiveUserId: binding.effectiveUserId,
      ...device,
    }).onConflictDoUpdate({
      target: [mobilePushDevices.userId, mobilePushDevices.deviceId],
      set: {
        token: device.token,
        platform: device.platform,
        permission: device.permission,
        effectiveUserId: binding.effectiveUserId,
        locale: device.locale,
        enabled: true,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
  });

  return mobileOk({ registered: true });
}

export async function DELETE(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  const deviceId = body && typeof body === "object" && "deviceId" in body
    ? String(body.deviceId).trim()
    : "";
  if (deviceId.length < 8 || deviceId.length > 120) {
    return mobileError("errors.invalidData");
  }
  const binding = pushDeviceBinding(gate);
  await db.delete(mobilePushDevices).where(and(
    eq(mobilePushDevices.userId, binding.principalId),
    eq(mobilePushDevices.deviceId, deviceId),
  ));
  return mobileOk({ unregistered: true });
}
