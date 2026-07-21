import { z } from "zod";
import { orderItemSchema } from "@/lib/schemas/order";

export const returnItemInputSchema = z.object({
  orderItemId: z.uuid(),
  quantity: z.number().positive(),
  restock: z.boolean().default(true),
});

const returnItemsInputSchema = z.array(returnItemInputSchema)
  .min(1, { error: "returns.errors.emptyItems" })
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.orderItemId)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "orderItemId"],
          message: "returns.errors.duplicateItem",
        });
      }
      seen.add(item.orderItemId);
    }
  });

const refundMethodSchema = z.enum(["cash", "bank_transfer", "debt_deduct", "momo", "zalopay", "vnpay"]);
const gatewayRefundMethods = new Set(["momo", "zalopay", "vnpay"]);

export const createReturnSchema = z.object({
  orderId: z.uuid(),
  clientId: z.string().min(8).max(80).optional(),
  reason: z.string().min(1, { error: "validation.required" }),
  refundMethod: refundMethodSchema,
  note: z.string().optional(),
  items: returnItemsInputSchema,
}).superRefine((value, ctx) => {
  if (gatewayRefundMethods.has(value.refundMethod) && !value.clientId) {
    ctx.addIssue({ code: "custom", path: ["clientId"], message: "validation.required" });
  }
});

export type CreateReturnInput = z.input<typeof createReturnSchema>;
export type CreateReturnOutput = z.output<typeof createReturnSchema>;

export const createExchangeSchema = z.object({
  orderId: z.uuid(),
  clientId: z.string().min(8).max(40),
  reason: z.string().min(1, { error: "validation.required" }),
  refundMethod: refundMethodSchema,
  note: z.string().optional(),
  items: returnItemsInputSchema,
  exchangeItems: z.array(z.object({
    productId: z.uuid(),
    unitName: z.string().min(1),
    quantity: z.number().positive(),
  })).min(1, { error: "returns.errors.emptyExchangeItems" })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        const key = `${item.productId}:${item.unitName.trim().toLowerCase()}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "productId"],
            message: "returns.errors.duplicateExchangeItem",
          });
        }
        seen.add(key);
      }
    }),
  settlementMethod: z.enum(["cash", "bank_transfer", "card", "credit"]),
});

export type CreateExchangeInput = z.input<typeof createExchangeSchema>;
export type CreateExchangeOutput = z.output<typeof createExchangeSchema>;

export const createPosReturnSchema = z.object({
  orderId: z.uuid().optional(),
  customerId: z.uuid().nullable().optional(),
  warehouseId: z.uuid(),
  priceBookId: z.uuid().nullable().optional(),
  reason: z.string().min(1, { error: "validation.required" }),
  refundMethod: z.enum(["cash", "bank_transfer", "debt_deduct"]),
  note: z.string().optional(),
  items: z.array(orderItemSchema.extend({
    restock: z.boolean().default(true),
  })).min(1, { error: "returns.errors.emptyItems" }),
});

export type CreatePosReturnInput = z.input<typeof createPosReturnSchema>;
export type CreatePosReturnOutput = z.output<typeof createPosReturnSchema>;
