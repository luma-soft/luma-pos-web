import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mobilePushDevices } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { pushDeviceBinding } from "@/lib/notifications/device-binding";
import {
  deactivatePushDeviceBinding,
  registerPushDeviceBinding,
} from "@/lib/notifications/device-registration-core";

const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(120),
  platform: z.enum(["android", "ios"]),
  token: z.string().trim().min(20).max(4096),
  permission: z.enum(["authorized", "provisional"]),
  locale: z.string().trim().max(20).optional(),
  bindingGeneration: z.number().int().nonnegative().safe().default(0),
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
    .where(and(eq(mobilePushDevices.storeId, gate.storeId), eq(mobilePushDevices.userId, binding.principalId)));
  return mobileOk({ rows });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const parsed = deviceSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const device = parsed.data;
  const binding = pushDeviceBinding(gate);

  const result = await registerPushDeviceBinding(db, {
    storeId: gate.storeId,
    principalId: binding.principalId,
    effectiveUserId: binding.effectiveUserId,
    device,
  });

  if (result.kind === "busy") {
    return mobileError("errors.deviceBindingBusy", 409);
  }
  if (result.kind === "stale") {
    return mobileError("errors.deviceBindingStale", 409);
  }
  return mobileOk({
    registered: true,
    bindingGeneration: device.bindingGeneration,
  });
}

export async function DELETE(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request);
  const deviceId = body && typeof body === "object" && "deviceId" in body
    ? String(body.deviceId).trim()
    : "";
  const bindingGeneration = body
    && typeof body === "object"
    && "bindingGeneration" in body
    && Number.isSafeInteger(Number(body.bindingGeneration))
    && Number(body.bindingGeneration) >= 0
    ? Number(body.bindingGeneration)
    : 0;
  if (deviceId.length < 8 || deviceId.length > 120) {
    return mobileError("errors.invalidData");
  }
  const binding = pushDeviceBinding(gate);
  const result = await deactivatePushDeviceBinding(db, {
    storeId: gate.storeId,
    principalId: binding.principalId,
    deviceId,
    bindingGeneration,
  });
  if (result.kind === "busy") {
    return mobileError("errors.deviceBindingBusy", 409);
  }
  if (result.kind === "stale") {
    return mobileError("errors.deviceBindingStale", 409);
  }
  return mobileOk({ unregistered: true, bindingGeneration });
}
