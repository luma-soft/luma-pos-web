import { z } from "zod";
import { createOrderSchema } from "@/lib/schemas/order";
import {
  serviceChecklistUpdateSchema,
  serviceFieldAssetCreateSchema,
  serviceFieldMaterialUsageSchema,
} from "@/lib/services/schemas";

export const POS_ORDER_SYNC_COMMAND = "pos.order.create" as const;
export const SERVICE_FIELD_MUTATION_SYNC_COMMAND = "service.field.mutation" as const;
export const SYNC_RELAY_MAX_BODY_BYTES = 65_536;
export const SYNC_RELAY_STATUS_LIMIT = 100;

const syncRelayEnvelopeSchema = z.object({
  eventId: z.uuid(),
  storeId: z.uuid(),
  deviceId: z.string().trim().min(1).max(200),
  baseRevision: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().safe(),
  ]).optional(),
}).strict();

export const posOrderSyncSchema = syncRelayEnvelopeSchema.extend({
  commandType: z.literal(POS_ORDER_SYNC_COMMAND).optional(),
  payload: createOrderSchema,
}).strict().superRefine((value, context) => {
  const order = value.payload;
  if (!order.clientId?.trim()) {
    context.addIssue({ code: "custom", path: ["payload", "clientId"], message: "A stable client ID is required" });
  }
  if (
    order.source || order.posDraftId || order.paymentPending || order.paymentSessionId ||
    order.payment.method === "bank_transfer"
  ) {
    context.addIssue({ code: "custom", path: ["payload"], message: "This order flow cannot be queued for offline sync" });
  }
});

const serviceFieldMutationPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("checklist.update") }).merge(serviceChecklistUpdateSchema).strict(),
  z.object({ type: z.literal("material.usage") }).merge(serviceFieldMaterialUsageSchema).strict(),
  z.object({ type: z.literal("asset.create") }).merge(serviceFieldAssetCreateSchema).strict(),
]);

const serviceFieldMutationSyncSchema = syncRelayEnvelopeSchema.extend({
  commandType: z.literal(SERVICE_FIELD_MUTATION_SYNC_COMMAND),
  payload: serviceFieldMutationPayloadSchema,
}).strict();

export const syncRelaySubmitSchema = z.union([
  posOrderSyncSchema,
  serviceFieldMutationSyncSchema,
]);

export type SyncRelaySubmit = z.output<typeof syncRelaySubmitSchema>;
export type SyncRelaySubmitInput = z.input<typeof syncRelaySubmitSchema>;
export type POSOrderSyncPayload = z.output<typeof createOrderSchema>;
export type ServiceFieldMutationRelayPayload = z.output<typeof serviceFieldMutationPayloadSchema>;

export type SyncRelayReceipt = {
  position: string;
  eventId: string;
  storeId: string;
  status: "pending" | "processing" | "accepted" | "rejected" | "conflict";
  result: Record<string, unknown> | null;
  errorCode: string | null;
  processedAt: string | null;
};
