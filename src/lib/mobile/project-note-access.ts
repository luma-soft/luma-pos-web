import { z } from "zod";
import type { MobileGate } from "@/lib/mobile/auth";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";

export const projectNoteContentSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export function canReadProjectNotes(
  gate: Extract<MobileGate, { ok: true }>,
  serviceType: string | null,
) {
  if (serviceType) {
    return storeFeatureEnabled(gate.features, "field_services")
      && ["owner", "manager", "technician"].includes(gate.role);
  }
  return ["owner", "manager", "cashier"].includes(gate.role);
}

export function canManageProjectNotes(
  gate: Extract<MobileGate, { ok: true }>,
  serviceType: string | null,
) {
  return !serviceType
    || storeFeatureEnabled(gate.features, "field_services");
}
