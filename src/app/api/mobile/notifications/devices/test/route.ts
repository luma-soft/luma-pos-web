import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { mobilePushDevices } from "@/db/schema";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { pushDeviceBinding } from "@/lib/notifications/device-binding";
import { sendTestPushToDevice } from "@/lib/notifications/push";
import { db, requireMobileUser } from "../dependencies";

const requestSchema = z.object({
  deviceId: z.string().trim().min(8).max(120),
});

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");

  const binding = pushDeviceBinding(gate);
  const [device] = await db.select({
    token: mobilePushDevices.token,
    locale: mobilePushDevices.locale,
  }).from(mobilePushDevices).where(and(
    eq(mobilePushDevices.storeId, gate.storeId),
    eq(mobilePushDevices.userId, binding.principalId),
    eq(mobilePushDevices.effectiveUserId, binding.effectiveUserId),
    eq(mobilePushDevices.deviceId, parsed.data.deviceId),
    eq(mobilePushDevices.platform, "ios"),
    eq(mobilePushDevices.enabled, true),
  )).limit(1);

  if (!device) return mobileError("errors.notFound", 404);

  const result = await sendTestPushToDevice({
    fid: device.token,
    locale: device.locale,
  });
  if (result.kind !== "sent") {
    return mobileError(result.code, result.kind === "retry" ? 503 : 502);
  }

  return mobileOk({ sent: true });
}
