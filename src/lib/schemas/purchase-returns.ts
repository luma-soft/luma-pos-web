import { z } from "zod";

export const purchaseReturnItemSchema = z.object({
  productId: z.uuid(),
  unitName: z.string().min(1).optional(),
  unitMultiplier: z.number().positive().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
  returnUnitCost: z.number().min(0),
});

export const createPurchaseReturnSchema = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  purchaseOrderId: z.uuid().nullable().optional(),
  discount: z.number().min(0).default(0),
  vatRate: z.number().min(0).max(100).default(0),
  refundAmount: z.number().min(0).default(0),
  refundMethod: z.enum(["cash", "bank_transfer"]).nullable().optional(),
  debtAmount: z.number().min(0).default(0),
  note: z.string().optional(),
  items: z.array(purchaseReturnItemSchema).min(1, { error: "purchaseReturns.errors.emptyItems" }),
});

export type CreatePurchaseReturnInput = z.input<typeof createPurchaseReturnSchema>;
export type CreatePurchaseReturnOutput = z.output<typeof createPurchaseReturnSchema>;
