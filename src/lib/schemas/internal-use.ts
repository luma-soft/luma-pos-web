import { z } from "zod";

export const internalUseItemSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string().min(1),
  unitName: z.string().min(1),
  unitMultiplier: z.number().positive(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
});

export const createInternalUseSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  department: z.string().optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
  items: z.array(internalUseItemSchema).min(1),
});

export type CreateInternalUseInput = z.input<typeof createInternalUseSchema>;
export type CreateInternalUseOutput = z.output<typeof createInternalUseSchema>;
